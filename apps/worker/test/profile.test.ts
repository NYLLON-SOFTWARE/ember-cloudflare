import { feature } from "@ember/parity";
import { MAX_BIO_LENGTH, type Bootstrap, type Directory, type DirectoryUser, type NewWorkspace, type Profile, type ProfileAnswer, type UserId } from "@ember/protocol";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { credentialsOf } from "../src/auth";
import type { Env } from "../src/env";
import type { Workspace } from "../src/workspace";
import { api, cookieOf, freshDeploy, openWorkspaceSocket, origin, shown, signIn, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

const profileOf = async (session: Session) => ((await (await api("/api/users/me/profile", { headers: as(session) })).json()) as ProfileAnswer).profile;

const save = (session: Session | null, body: unknown, headers: Record<string, string> = {}) =>
  api("/api/users/me/profile", { method: "PATCH", headers: { ...as(session), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** Signs in with an email address and password, as the sign-in form does. */
const signInWith = (emailAddress: string, password: string) => api("/api/session", { method: "POST", body: JSON.stringify({ emailAddress, password }) });

const me = (session: Session) => api("/api/me", { headers: as(session) });

/** Someone as the directory lists them, as `viewer` sees it. */
async function listed(viewer: Session, userId: UserId): Promise<DirectoryUser> {
  const { users } = (await (await api("/api/users", { headers: as(viewer) })).json()) as Directory;
  return users.find((user) => user.id === userId)!;
}

interface StoredPerson {
  name: string;
  email_address: string | null;
  bio: string | null;
  password_digest: string | null;
  updated_at: string;
}

const stored = async (userId: UserId) =>
  ((await workspaceSql("SELECT name, email_address, bio, password_digest, updated_at FROM users WHERE id = ?", userId)) as StoredPerson[])[0]!;

const LONG_AGO = "2026-01-01T00:00:00.000Z";

beforeEach(freshDeploy);

describe(feature("users.profile"), () => {
  it("shows you your name, email address and bio, or none for someone who signed in with just a name", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await workspaceSql("UPDATE users SET bio = ? WHERE id = ?", "Rear admiral", grace.user.id);

    const response = await api("/api/users/me/profile", { headers: as(administrator) });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ profile: { name: "Ada Lovelace", emailAddress: "ada@example.com", bio: null }, transferId: expect.any(String) } satisfies ProfileAnswer);
    expect(await profileOf(grace)).toEqual({ name: "Grace Hopper", emailAddress: null, bio: "Rear admiral" } satisfies Profile);
  });

  it("saves your name, email address and bio, answering your profile as it is then", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const changed: Profile = { name: "Grace Brewster Hopper", emailAddress: "grace@example.com", bio: "Wrote the first compiler" };

    const response = await save(grace, changed);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: changed, transferId: expect.any(String) } satisfies ProfileAnswer);
    expect(await profileOf(grace)).toEqual(changed);
    expect(await (await me(grace)).json()).toEqual({ user: { id: grace.user.id, name: "Grace Brewster Hopper", administrator: false } });
    expect(await listed(administrator, grace.user.id)).toMatchObject({ name: "Grace Brewster Hopper", bio: "Wrote the first compiler" });
  });

  it("changes only what's sent, writing nothing when nothing differs", async () => {
    const grace = await signIn("Grace Hopper");
    await workspaceSql("UPDATE users SET bio = ?, updated_at = ? WHERE id = ?", "Rear admiral", LONG_AGO, grace.user.id);

    for (const body of [{}, { name: "Grace Hopper" }, { bio: "Rear admiral", password: "" }]) {
      const response = await save(grace, body);
      expect(response.status, JSON.stringify(body)).toBe(200);
      expect(await response.json()).toEqual({ profile: { name: "Grace Hopper", emailAddress: null, bio: "Rear admiral" }, transferId: expect.any(String) });
      expect((await stored(grace.user.id)).updated_at).toBe(LONG_AGO);
    }

    expect(await (await save(grace, { bio: "Admiral" })).json()).toEqual({ profile: { name: "Grace Hopper", emailAddress: null, bio: "Admiral" }, transferId: expect.any(String) });
    expect((await stored(grace.user.id)).updated_at > LONG_AGO).toBe(true);
  });

  it("takes the name as typed, even blank, as ember-rust's server does", async () => {
    const grace = await signIn("Grace Hopper");
    for (const name of ["  Amazing Grace ", ""]) {
      expect(await (await save(grace, { name })).json()).toMatchObject({ profile: { name } });
      expect((await stored(grace.user.id)).name).toBe(name);
    }
  });

  it("saves a blank email address or bio as none, so any number of people can be without one", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await save(grace, { emailAddress: "grace@example.com", bio: "Rear admiral" });

    for (const person of [administrator, grace]) {
      const response = await save(person, { emailAddress: "", bio: "" });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ profile: { emailAddress: null, bio: null } });
      expect(await stored(person.user.id)).toMatchObject({ email_address: null, bio: null });
    }
  });

  it("refuses an email address someone else has, saving nothing, where ember-rust fails", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await workspaceSql("UPDATE users SET updated_at = ? WHERE id = ?", LONG_AGO, grace.user.id);

    const response = await save(grace, { name: "Grace Brewster Hopper", emailAddress: ada.emailAddress });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "That email address has an account already" });
    expect(await stored(grace.user.id)).toMatchObject({ name: "Grace Hopper", email_address: null, updated_at: LONG_AGO });
    // Their own, and anyone else's that differs in case, which sign-in tells apart.
    expect((await save(administrator, { emailAddress: ada.emailAddress, bio: "Countess" })).status).toBe(200);
    expect((await save(grace, { emailAddress: "ADA@example.com" })).status).toBe(200);
  });

  it("signs you in with a new password, and not the old one, keeping every session signed in", async () => {
    const administrator = await setUp();
    const laptop = { user: administrator.user, cookie: cookieOf(await signInWith(ada.emailAddress, ada.password)) };

    expect((await save(administrator, { password: "difference engine" })).status).toBe(200);
    expect((await signInWith(ada.emailAddress, ada.password)).status).toBe(401);
    expect((await signInWith(ada.emailAddress, "difference engine")).status).toBe(201);
    for (const session of [administrator, laptop]) expect((await me(session)).status).toBe(200);
  });

  it("keeps your password when the new one is blank, as ember-rust ignores it", async () => {
    const administrator = await setUp();
    const { password_digest: digest } = await stored(administrator.user.id);

    expect((await save(administrator, { name: "Ada King", password: "" })).status).toBe(200);
    expect(await stored(administrator.user.id)).toMatchObject({ name: "Ada King", password_digest: digest });
    expect((await signInWith(ada.emailAddress, ada.password)).status).toBe(201);
  });

  it("saves nothing once a password reset ahead of it has ended the session, keeping the reset's password", async () => {
    const administrator = await setUp();
    const credentials = (await credentialsOf(new Request(origin, { headers: as(administrator) }), env as unknown as Env))!;

    const answers = await runInDurableObject(workspaceStub(), async (workspace: Workspace) => {
      // The route checks the session before hashing a new password, and on D1 a reset can begin meanwhile.
      expect(await workspace.authenticate(credentials)).not.toBeNull();
      const reset = workspace.resetPassword(ada.emailAddress, "recovery digest");
      const saved = workspace.changeProfile(credentials, { name: "Mallory" }, "their own digest");
      return Promise.all([reset, saved]);
    });
    expect(answers).toEqual(["reset", null]);
    expect(await stored(administrator.user.id)).toMatchObject({ name: "Ada Lovelace", password_digest: "recovery digest" });
  });

  it("gives a password to someone who signed in with just a name, which signs them in once they have an email address", async () => {
    await setUp();
    const grace = await signIn("Grace Hopper");
    expect((await save(grace, { emailAddress: "grace@example.com", password: "compiler" })).status).toBe(200);
    expect((await signInWith("grace@example.com", "compiler")).status).toBe(201);
  });

  it("tells everyone's workspace sockets of a new name or bio, as the directory then lists you", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    await workspaceSql("UPDATE users SET updated_at = ? WHERE id = ?", LONG_AGO, grace.user.id);
    const before = await listed(grace, grace.user.id);
    const sockets = [await openWorkspaceSocket(administrator), await openWorkspaceSocket(grace)];

    await save(grace, { name: "Amazing Grace", bio: "Rear admiral" });
    const now = await listed(administrator, grace.user.id);
    expect(now).toMatchObject({ name: "Amazing Grace", bio: "Rear admiral" });
    // The initials changed, and so does the avatar's address.
    expect(now.avatarUrl).not.toBe(before.avatarUrl);
    for (const socket of sockets) expect(await socket.next()).toEqual({ type: "user.updated", user: now });
  });

  it("tells nobody of a new email address or password, which nobody else sees", async () => {
    const administrator = await setUp();
    const socket = await openWorkspaceSocket(administrator);

    await save(administrator, { emailAddress: "countess@example.com", password: "difference engine" });
    await save(administrator, { bio: "Countess" });
    // Only the bio was told.
    expect(await socket.next()).toMatchObject({ type: "user.updated", user: { bio: "Countess" } });
  });

  it("offers an administrator's new name and email address on sign-in, for help", async () => {
    const administrator = await setUp();
    const helpContact = async () => ((await (await api("/api/bootstrap")).json()) as Bootstrap).helpContact;
    expect(await helpContact()).toEqual({ name: "Ada Lovelace", emailAddress: ada.emailAddress });

    await save(administrator, { name: "Ada King", emailAddress: "countess@example.com" });
    expect(await helpContact()).toEqual({ name: "Ada King", emailAddress: "countess@example.com" });
  });

  it.each([
    ["a body that isn't an object", "[]", "Expected a JSON object"],
    ["a name that isn't text", { name: 1 }, "Name must be text"],
    ["a password longer than sign-in takes", { name: "Grace", password: "x".repeat(73) }, "Password must be at most 72 characters."],
    ["a bio longer than the form takes", { bio: "x".repeat(MAX_BIO_LENGTH + 1) }, `Bio must be at most ${MAX_BIO_LENGTH} characters`],
  ])("refuses %s, saving nothing", async (_, body, error) => {
    const grace = await signIn("Grace Hopper");
    const before = await stored(grace.user.id);
    const response = await save(grace, body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error });
    expect(await stored(grace.user.id)).toEqual(before);
  });

  it("answers 401 to anyone signed out, before anything they sent is checked", async () => {
    await setUp();
    expect((await api("/api/users/me/profile")).status).toBe(401);
    for (const body of [{ name: "Grace" }, "[]"]) expect((await save(null, body)).status).toBe(401);
  });

  it("refuses a save from another site", async () => {
    const grace = await signIn("Grace Hopper");
    expect((await save(grace, { name: "Mallory" }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(422);
    expect((await stored(grace.user.id)).name).toBe("Grace Hopper");
  });

  it("answers only reading and saving it", async () => {
    const grace = await signIn("Grace Hopper");
    for (const method of ["PUT", "POST", "DELETE"]) {
      expect((await api("/api/users/me/profile", { method, headers: as(grace), body: JSON.stringify({ name: "Mallory" }) })).status).toBe(404);
    }
    expect((await api(`/api/users/${grace.user.id}/profile`, { headers: as(grace) })).status).toBe(404);
    expect((await stored(grace.user.id)).name).toBe("Grace Hopper");
  });
});
