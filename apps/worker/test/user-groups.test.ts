import { GROUP_MEMBER_UNKNOWN, GROUP_NAME_TAKEN, GROUP_TOO_BIG, GROUPS_FULL, MAX_GROUPS, type Directory, type NewWorkspace, type UserGroup } from "@ember/protocol";
import { GROUP_MENTION_CONTENT_TYPE, mentionGroupSgid } from "@ember/richtext";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, connect, cookieOf, createRoom, direct, freshDeploy, freshRoom, post, pushBrowser, roomSql, shown, signIn, workspaceSql, type PushBrowser, type Session } from "./support";

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

/** Adds someone to the workspace without signing them in, as person `role` (0 a member, 2 a bot), answering their id. */
async function person(name: string, role = 0): Promise<string> {
  const id = `user-${crypto.randomUUID()}`;
  await workspaceSql(`INSERT INTO users (id, name, status, role, created_at, updated_at) VALUES (?, ?, 0, ?, 'now', 'now')`, id, name, role);
  return id;
}

const as = (session: Session | null): Record<string, string> => (session ? { Cookie: session.cookie } : {});

const list = (session: Session | null) => api("/api/user_groups", { headers: as(session) });
const add = (session: Session | null, body: unknown) => api("/api/user_groups", { method: "POST", headers: as(session), body: JSON.stringify(body) });
const change = (session: Session | null, id: string, body: unknown) => api(`/api/user_groups/${id}`, { method: "PATCH", headers: as(session), body: JSON.stringify(body) });
const remove = (session: Session | null, id: string) => api(`/api/user_groups/${id}`, { method: "DELETE", headers: as(session) });

/** Gives `session`'s person `involvement` in room `roomId`, as their bell does. */
const involve = (session: Session, roomId: string, involvement: string) =>
  api(`/api/rooms/${roomId}/involvement`, { method: "PUT", headers: as(session), body: JSON.stringify({ involvement }) });

/** Saves a subscription for `session` at Chrome's push service, at `/fcm/send/<label>`, for `browser`'s keys. */
async function subscribe(session: Session, label: string, browser?: PushBrowser): Promise<void> {
  const { p256dh, auth } = browser ?? (await pushBrowser());
  const endpoint = `https://fcm.googleapis.com/fcm/send/${label}`;
  const response = await api("/api/push-subscriptions", { method: "POST", headers: { Cookie: session.cookie }, body: JSON.stringify({ endpoint, p256dhKey: p256dh, authKey: auth }) });
  expect(response.status, await response.clone().text()).toBe(204);
}

/** Stands in for every push service, answering each push with 201, and keeps what was pushed where. */
function pushServices() {
  const pushed: Array<{ endpoint: string; body: Uint8Array }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    pushed.push({ endpoint: input instanceof Request ? input.url : String(input), body: init!.body as Uint8Array });
    return new Response(null, { status: 201 });
  });
  return pushed;
}

/** The group an answer gives, once it's checked to have succeeded with `status`. */
async function groupOf(response: Response, status = 200): Promise<UserGroup> {
  expect(response.status, await response.clone().text()).toBe(status);
  return ((await response.json()) as { group: UserGroup }).group;
}

/** The workspace's groups as the directory lists them. */
async function directoryGroups(session: Session): Promise<UserGroup[]> {
  const { groups } = (await (await api("/api/users", { headers: as(session) })).json()) as Directory;
  return groups;
}

/** A mention of the group `groupId`, as Lexxy writes one. */
const groupMention = (groupId: string) => `<action-text-attachment sgid="${mentionGroupSgid(groupId)}" content-type="${GROUP_MENTION_CONTENT_TYPE}"></action-text-attachment>`;

beforeEach(freshDeploy);

describe("User groups", () => {
  it("makes a group, keeping the name lowercased and everyone sent in it, and lists it by name", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const alan = await person("Alan Turing");
    const created = await groupOf(await add(administrator, { name: "On Call", memberIds: [grace.user.id, alan] }), 201);
    // Everyone in it, by name, as a mention of the group names them.
    expect(created).toEqual({ id: created.id, name: "on call", memberIds: [alan, grace.user.id] });

    const { groups } = (await (await list(administrator)).json()) as { groups: UserGroup[] };
    expect(groups).toEqual([created]);
    expect(await directoryGroups(administrator)).toEqual([created]);
    // A member sees them too, as a mention's autocomplete names them for everyone.
    expect((await (await list(grace)).json()) as { groups: UserGroup[] }).toEqual({ groups: [created] });
  });

  it("answers 403 to a member and 401 to anyone signed out, changing nothing", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    for (const response of [await add(grace, { name: "design", memberIds: [] }), await change(grace, "g000000000000000", { name: "x" }), await remove(grace, "g000000000000000")]) {
      expect(response.status).toBe(403);
    }
    for (const response of [await add(null, { name: "design", memberIds: [] }), await list(null)]) expect(response.status).toBe(401);
    // A member is told the groups, as the people directory names them for a mention's prompt.
    expect(await list(grace).then((response) => response.status)).toBe(200);
    expect(((await (await list(grace)).json()) as { groups: unknown[] }).groups).toEqual([]);
    expect(((await (await list(administrator)).json()) as { groups: unknown[] }).groups).toEqual([]);
  });

  it("keeps two groups from sharing a name, however they're capitalised", async () => {
    const administrator = await setUp();
    await groupOf(await add(administrator, { name: "design", memberIds: [] }), 201);
    const refused = await add(administrator, { name: "DESIGN", memberIds: [] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: GROUP_NAME_TAKEN });

    const other = await groupOf(await add(administrator, { name: "on call", memberIds: [] }), 201);
    const renamed = await change(administrator, other.id, { name: "Design" });
    expect(renamed.status).toBe(422);
    expect(await renamed.json()).toEqual({ error: GROUP_NAME_TAKEN });
    // A group renamed to its own name, capitals or not, is kept.
    const again = await groupOf(await change(administrator, other.id, { name: "On Call" }));
    expect(again.name).toBe("on call");
  });

  it("refuses a group of more than 100 people, and one naming someone who isn't an active person", async () => {
    const administrator = await setUp();
    const hundred = [];
    for (let n = 0; n < 100; n++) hundred.push(await person(`Person ${String(n).padStart(2, "0")}`));
    const refused = await add(administrator, { name: "everyone", memberIds: [...hundred, administrator.user.id] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: GROUP_TOO_BIG });

    const gone = await person("Former");
    await workspaceSql("UPDATE users SET status = 1 WHERE id = ?", gone);
    const unknown = await add(administrator, { name: "design", memberIds: [gone, "nobody00000000000"] });
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({ error: GROUP_MEMBER_UNKNOWN });
  });

  it("keeps a group's members the active people alone, once each, dropping a bot and a repeated id", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const bender = await person("Bender", 2);
    const group = await groupOf(await add(administrator, { name: "staff", memberIds: [grace.user.id, grace.user.id, bender] }), 201);
    expect(group.memberIds).toEqual([grace.user.id]);
    // And a change does the same, saving the rest of what's sent.
    const changed = await groupOf(await change(administrator, group.id, { memberIds: [bender, grace.user.id] }));
    expect(changed.memberIds).toEqual([grace.user.id]);
  });

  it("refuses another group once the workspace keeps 1,000, and takes one once a group goes", async () => {
    const administrator = await setUp();
    await workspaceSql(
      `WITH RECURSIVE many(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM many WHERE i < ${MAX_GROUPS})
       INSERT INTO user_groups (id, name, created_by, created_at, updated_at)
       SELECT printf('g%015d', i), printf('group %04d', i), ?, 'now', 'now' FROM many`,
      administrator.user.id,
    );
    const refused = await add(administrator, { name: "one too many", memberIds: [] });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ error: GROUPS_FULL });

    await workspaceSql(`DELETE FROM user_groups WHERE id = 'g${"0".repeat(14)}1'`);
    const created = await groupOf(await add(administrator, { name: "one more", memberIds: [] }), 201);
    expect(created.name).toBe("one more");
  });

  it("changes a group's name and members, and deletes it, which the directory drops", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const alan = await signIn("Alan Turing");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id] }), 201);

    const changed = await groupOf(await change(administrator, group.id, { name: "Design & code", memberIds: [grace.user.id, alan.user.id] }));
    expect(changed).toEqual({ id: group.id, name: "design & code", memberIds: [alan.user.id, grace.user.id] });

    // A change naming no group is 404, whatever it sends.
    expect((await change(administrator, "g000000000000000", { name: "x" })).status).toBe(404);
    expect((await remove(administrator, "g000000000000000")).status).toBe(404);

    expect((await remove(administrator, group.id)).status).toBe(204);
    expect(((await (await list(administrator)).json()) as { groups: unknown[] }).groups).toEqual([]);
    expect(await directoryGroups(administrator)).toEqual([]);
  });

  it("keeps a message's group mention naming the group, and mentions everyone in it", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const alan = await signIn("Alan Turing");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id, alan.user.id] }), 201);
    const room = await freshRoom("mentioning");
    const ada = await connect(room, administrator);

    const message = await post(ada, `<p>Hi ${groupMention(group.id)}!</p>`);
    expect(message).toMatchObject({
      body: `<p>Hi <action-text-attachment content-type="${GROUP_MENTION_CONTENT_TYPE}" sgid="${mentionGroupSgid(group.id)}"></action-text-attachment>!</p>`,
      plainText: "Hi @design!",
      // Everyone the group stands for, named as they are now.
      mentions: [
        { id: alan.user.id, name: "Alan Turing" },
        { id: grace.user.id, name: "Grace Hopper" },
      ],
    });
    // What the room keeps is what its log tells the Workspace of, whom "mentions me", the unread marks,
    // the pushes and the search then find, as of a person's mention.
    expect((await roomSql(room, "SELECT mentions FROM messages WHERE id = ?", message.id)) as [{ mentions: string }]).toEqual([
      {
        mentions: JSON.stringify([
          { id: alan.user.id, name: "Alan Turing" },
          { id: grace.user.id, name: "Grace Hopper" },
        ]),
      },
    ]);
  });

  it("pushes a message mentioning a group to everyone in it, at @mentions, and to nobody else", async () => {
    const administrator = await setUp();
    const room = await freshRoom("pushed");
    const grace = await signIn("Grace Hopper");
    const linus = await signIn("Linus");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id] }), 201);
    await subscribe(grace, "grace");
    await subscribe(linus, "linus");
    // At only @mentions, which a group's mention is for everyone it stands for.
    await involve(grace, room, "mentions");
    await involve(linus, room, "mentions");
    const pushed = pushServices();
    const ada = await connect(room, administrator, { visible: true });

    await post(ada, `<p>Hi ${groupMention(group.id)}!</p>`);
    await vi.waitFor(() => expect(pushed).toHaveLength(1), { timeout: 5_000 });
    expect(pushed[0]!.endpoint.endsWith("/grace")).toBe(true);
  });

  it("mentions a group in a DM, where everyone hears all messages", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const alan = await signIn("Alan Turing");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id, alan.user.id] }), 201);
    const dm = await direct(administrator, grace, alan);
    const ada = await connect(dm.id, administrator);

    const message = await post(ada, `<p>Hi ${groupMention(group.id)}!</p>`);
    expect(message).toMatchObject({
      plainText: "Hi @design!",
      mentions: [
        { id: alan.user.id, name: "Alan Turing" },
        { id: grace.user.id, name: "Grace Hopper" },
      ],
    });
  });

  it("mentions a group whose member isn't in the room, standing for them all the same", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const alan = await signIn("Alan Turing");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id, alan.user.id] }), 201);
    // A closed room Alan was never let into.
    const room = await createRoom("Closed", { closedTo: [administrator.user.id, grace.user.id], as: administrator });
    const ada = await connect(room.id, administrator);

    const message = await post(ada, `<p>Hi ${groupMention(group.id)}!</p>`);
    expect(message).toMatchObject({
      plainText: "Hi @design!",
      mentions: [
        { id: alan.user.id, name: "Alan Turing" },
        { id: grace.user.id, name: "Grace Hopper" },
      ],
    });
    // But nothing marks the room for him, which isn't his.
    expect(
      (await workspaceSql("SELECT count(*) AS n FROM memberships WHERE room_id = ? AND user_id = ?", room.id, alan.user.id)) as [{ n: number }],
    ).toEqual([{ n: 0 }]);
  });

  it("stores ☒ for a mention of a group that isn't one, as a person's", async () => {
    const administrator = await setUp();
    const room = await freshRoom("unknown");
    const ada = await connect(room, administrator);

    const message = await post(ada, `<p>Hi ${groupMention("nobody00000000000")}!</p>`);
    expect(message).toMatchObject({ body: "<p>Hi ☒!</p>", plainText: "Hi ☒!", mentions: [] });
    // A message of nothing but it isn't empty, as one of an unknown person's mention isn't.
    const only = await post(ada, `<p>${groupMention("nobody00000000000")}</p>`);
    expect(only).toMatchObject({ body: "<p>☒</p>", plainText: "☒" });
  });

  it("offers the groups after the people in the mentions prompt, with how many each stands for", async () => {
    const administrator = await setUp();
    const grace = await signIn("Grace Hopper");
    const group = await groupOf(await add(administrator, { name: "design", memberIds: [grace.user.id] }), 201);
    await groupOf(await add(administrator, { name: "on call", memberIds: [] }), 201);
    const prompt = async (query = "") => await (await api(`/api/autocompletable/users${query}`, { headers: as(administrator) })).text();

    const offered = await prompt();
    expect(offered).toContain(`search="Ada Lovelace"`);
    expect(offered.indexOf(`search="design"`)).toBeGreaterThan(offered.indexOf(`search="Grace Hopper"`));
    expect(offered).toContain(`<span class="autocompletable__badge">1 member</span>`);
    expect(offered).toContain(`content-type="${GROUP_MENTION_CONTENT_TYPE}" sgid="${mentionGroupSgid(group.id)}"`);
    // Filtered as the people are, by name.
    expect(await prompt("?filter=on")).toContain(`search="on call"`);
    expect(await prompt("?filter=on")).not.toContain(`search="design"`);
    expect(await prompt("?filter=zz")).not.toContain(`search="design"`);
    expect(await prompt("?filter=design")).toContain(`search="design"`);
  });
});
