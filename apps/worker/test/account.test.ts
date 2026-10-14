import { feature } from "@ember/parity";
import { MAX_ACCOUNT_NAME_LENGTH, type Bootstrap, type NewWorkspace, type WorkspaceSettings } from "@ember/protocol";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { credentialsFor } from "../src/auth";
import type { Env } from "../src/env";
import type { Workspace } from "../src/workspace";
import type { JoinableAccount, WorkspaceStore } from "../src/workspace-store";
import { api, cookieOf, freshDeploy, origin, shown, signIn, workspaceSql, workspaceStub, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const as = (session?: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

const settings = (session?: Session) => api("/api/account", { headers: as(session) });

const change = (session: Session | null, body: unknown, headers: Record<string, string> = {}) =>
  api("/api/account", { method: "PATCH", headers: { ...as(session), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

const bootstrap = async (session?: Session) => (await (await api("/api/bootstrap", { headers: as(session) })).json()) as Bootstrap;

const storedAccount = async () => ((await workspaceSql("SELECT name, updated_at FROM accounts")) as Array<{ name: string; updated_at: string }>)[0]!;

/** What the Workspace's store would answer, from inside the Workspace. */
const storeOf = (workspace: Workspace) => (workspace as unknown as { store: WorkspaceStore }).store;

beforeEach(freshDeploy);

describe(feature("accounts.settings-page"), () => {
  it("shows anyone signed in the workspace, and whether they can change it", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");
    expect(await (await settings(administrator)).json()).toEqual({ account: { name: "Ember" }, canAdminister: true } satisfies WorkspaceSettings);
    expect(await (await settings(member)).json()).toEqual({ account: { name: "Ember" }, canAdminister: false } satisfies WorkspaceSettings);
  });

  it("asks who's signed in", async () => {
    await setUp();
    expect((await settings()).status).toBe(401);
  });

  it("has nothing to show before first run", async () => {
    const response = await settings(await signIn("Grace"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Ember isn't set up yet" });
  });
});

describe(feature("ui.rail"), () => {
  it("tells the app whether whoever is signed in is an administrator, for the rail's Admin link", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");
    expect((await bootstrap(administrator)).user).toEqual({ ...administrator.user, administrator: true });
    expect((await bootstrap(member)).user).toEqual({ ...member.user, administrator: false });
    expect(await (await api("/api/me", { headers: as(administrator) })).json()).toEqual({ user: { ...administrator.user, administrator: true } });
    expect(await (await api("/api/me", { headers: as(member) })).json()).toEqual({ user: { ...member.user, administrator: false } });
  });
});

describe(feature("accounts.name"), () => {
  it("renames the workspace for an administrator, wherever its name shows", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");

    const response = await change(administrator, { name: "Ember Studio" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: { name: "Ember Studio" } });
    expect((await storedAccount()).name).toBe("Ember Studio");

    expect(await (await settings(member)).json()).toEqual({ account: { name: "Ember Studio" }, canAdminister: false });
    expect((await bootstrap(member)).account).toEqual({ name: "Ember Studio" });
    // "Sign in to <name>", and the installed app's name.
    expect((await bootstrap()).account).toEqual({ name: "Ember Studio" });
    expect(await (await api("/webmanifest.json")).json()).toMatchObject({ name: "Ember Studio" });
  });

  it("saves the name as typed, even blank", async () => {
    const administrator = await setUp();
    for (const name of ["  Ember Studio ", "", "x".repeat(MAX_ACCOUNT_NAME_LENGTH)]) {
      expect(await (await change(administrator, { name })).json()).toEqual({ account: { name } });
      expect((await storedAccount()).name).toBe(name);
      expect((await bootstrap()).account).toEqual({ name });
    }
  });

  it("records when the name changed, but not when it's saved unchanged", async () => {
    const administrator = await setUp();
    const long = "2026-01-01T00:00:00.000Z";
    await workspaceSql("UPDATE accounts SET updated_at = ?", long);

    for (const body of [{ name: "Ember" }, {}]) {
      const response = await change(administrator, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ account: { name: "Ember" } });
      expect(await storedAccount()).toEqual({ name: "Ember", updated_at: long });
    }

    await change(administrator, { name: "Ember Studio" });
    expect((await storedAccount()).updated_at > long).toBe(true);
  });

  it("lets only administrators rename it, and tells anyone else so before looking at what they sent", async () => {
    await setUp();
    const member = await signIn("Grace");
    for (const body of [{ name: "Grace's place" }, "not JSON", { name: 7 }]) {
      const response = await change(member, body);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Only administrators can change the workspace" });
    }
    expect((await storedAccount()).name).toBe("Ember");
  });

  it("checks who's an administrator as they are when they rename it", async () => {
    const administrator = await setUp();
    const member = await signIn("Grace");
    await workspaceSql("UPDATE users SET role = 0 WHERE id = ?", administrator.user.id);
    expect((await change(administrator, { name: "Ada's place" })).status).toBe(403);

    await workspaceSql("UPDATE users SET role = 1 WHERE id = ?", member.user.id);
    expect((await change(member, { name: "Grace's place" })).status).toBe(200);
    expect((await storedAccount()).name).toBe("Grace's place");
  });

  it.each([
    ["no body", "", "Expected a JSON object"],
    ["a list", [], "Expected a JSON object"],
    ["a name that isn't text", { name: null }, `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`],
    ["a name that's too long", { name: "x".repeat(MAX_ACCOUNT_NAME_LENGTH + 1) }, `Name must be at most ${MAX_ACCOUNT_NAME_LENGTH} characters`],
  ])("refuses %s, changing nothing", async (_, body, error) => {
    const administrator = await setUp();
    const response = await change(administrator, body);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error });
    expect((await storedAccount()).name).toBe("Ember");
  });

  it("asks who's signed in, and refuses a rename sent from another site", async () => {
    const administrator = await setUp();
    expect((await change(null, { name: "Anyone's" })).status).toBe(401);
    expect((await change(administrator, { name: "Phished" }, { "Sec-Fetch-Site": "cross-site" })).status).toBe(422);
    expect((await storedAccount()).name).toBe("Ember");
  });

  it("reads the name again after a rename whose answer was lost", async () => {
    const administrator = await setUp();
    expect((await bootstrap()).account.name).toBe("Ember");
    // On D1 a write can be saved and its answer lost on the way back.
    await runInDurableObject(workspaceStub(), (workspace: Workspace) => {
      const store = storeOf(workspace);
      const rename = store.renameAccount.bind(store);
      vi.spyOn(store, "renameAccount").mockImplementationOnce(async (...args) => {
        await rename(...args);
        throw new Error("The database's answer was lost");
      });
    });
    expect((await change(administrator, { name: "Ember Studio" })).status).toBe(500);
    expect((await bootstrap()).account.name).toBe("Ember Studio");
  });

  it("doesn't keep a name read while the workspace was being renamed", async () => {
    const administrator = await setUp();
    const credentials = await credentialsFor(administrator.cookie.split("=")[1]!, new Request(origin), env as unknown as Env);
    // Started afresh, the Workspace has to read the account again.
    await evictDurableObject(workspaceStub());
    await runInDurableObject(workspaceStub(), async (workspace: Workspace) => {
      // On D1 a read can start before the rename and finish after it, with the name from before.
      let finishReading!: (account: JoinableAccount | null) => void;
      vi.spyOn(storeOf(workspace), "account").mockReturnValueOnce(new Promise((resolve) => (finishReading = resolve)));
      const reading = workspace.bootstrap(null);
      expect(await workspace.changeAccount(credentials, { name: "Ember Studio" })).toEqual({ name: "Ember Studio" });
      finishReading({ name: "Ember", joinCode: "aB3d-Ef5h-iJ7k" });
      await reading;
    });
    expect((await bootstrap()).account.name).toBe("Ember Studio");
  });
});
