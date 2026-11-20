import type { ExportedListing, ExportedMessages, Message, NewWorkspace, RoomId, ServerFrame } from "@ember/protocol";
import { beforeEach, describe, expect, it } from "vitest";
import { api, connect, cookieOf, createRoom, direct, freshDeploy, post, roomStub, shown, workspaceSql, type Client, type Session } from "./support";

// The workspace export, which scripts/export.ts writes as NDJSON for whoever keeps it: everyone with
// their roles, every room with who's in it where that's who it's for, and each room's messages a page
// at a time, the ones sent only to their threads and those deleted but kept for their replies among
// them. An administrator's alone, DMs and closed rooms being in it whoever they're for.

const ada = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "analytical engine" };
const grace = { name: "Grace Hopper", emailAddress: "grace@example.com", password: "compiler" };
const linus = { name: "Linus Torvalds", emailAddress: "linus@example.com", password: "kernel panic" };

/** Sets Ember up with Ada as its administrator, signed in. */
async function setUp(): Promise<Session> {
  const response = await api("/api/first_run", { method: "POST", body: JSON.stringify(ada) });
  expect(response.status).toBe(201);
  return { user: shown(((await response.json()) as NewWorkspace).user), cookie: cookieOf(response) };
}

const joinCode = async () => ((await workspaceSql("SELECT join_code FROM accounts")) as Array<{ join_code: string }>)[0]!.join_code;

/** Joins with the workspace's join link, as its form does, and answers their session. */
async function member(person: { name: string; emailAddress: string; password: string }): Promise<Session> {
  const joined = await api(`/api/join/${await joinCode()}`, { method: "POST", body: JSON.stringify(person), headers: { "User-Agent": "Their laptop", "CF-Connecting-IP": "203.0.113.9" } });
  expect(joined.status).toBe(201);
  return { user: shown(((await joined.json()) as { user: { id: string; name: string } }).user), cookie: cookieOf(joined) };
}

/** Signs in with an email address and a password, as the export script does. */
const signedIn = ({ emailAddress, password }: { emailAddress: string; password: string }) =>
  api("/api/session", { method: "POST", body: JSON.stringify({ emailAddress, password }) });

/** The listing the export answers the session `cookie` carries, if any. */
const listingOf = (cookie?: string) => api("/api/export", { headers: cookie ? { Cookie: cookie } : {} });

/** The page of the room's messages after `after`, or the first, that the export answers the session `cookie` carries. */
const pageOf = (roomId: RoomId, cookie: string, after?: string) =>
  api(`/api/export/rooms/${roomId}/messages${after ? `?after=${after}` : ""}`, { headers: { Cookie: cookie } });

/** Replies to `parent` in its thread as `client`, sending the reply to the room too if `alsoSend`. */
async function reply(client: Client, parent: Message, body: string, alsoSend = false): Promise<Message> {
  const clientMessageId = crypto.randomUUID();
  client.send({ type: "message.create", clientMessageId, body, parentId: parent.id, alsoSend });
  for (;;) {
    const { message } = await client.next("message.created");
    if (message.clientMessageId === clientMessageId) return message;
  }
}

/** The next frame changing message `id` that `client` hears. */
async function updated(client: Client, id: string): Promise<Extract<ServerFrame, { type: "message.updated" }>> {
  for (;;) {
    const frame = await client.next("message.updated");
    if (frame.message.id === id) return frame;
  }
}

/** The rooms of `listed`, by their names, which only shared rooms have. */
const roomNamed = (listed: ExportedListing, name: string) => listed.rooms.find((room) => room.name === name)!;

beforeEach(freshDeploy);

describe("The workspace export", () => {
  it("lists everyone with their roles, and every room with who's in it where that's who it's for", async () => {
    const administrator = await setUp();
    const graceSession = await member(grace);
    const linusSession = await member(linus);
    // A closed room Grace makes for herself and Linus, which Ada isn't in, and their DM and hers with
    // herself: the rooms an export says more about than a sidebar would.
    const launch = await createRoom("Launch", { closedTo: [graceSession.user.id, linusSession.user.id], as: graceSession });
    const together = await direct(graceSession, linusSession);
    const toHerself = await direct(graceSession);

    const listed = (await (await listingOf(administrator.cookie)).json()) as ExportedListing;
    expect(listed.users.map(({ name, emailAddress, role, status }) => ({ name, emailAddress, role, status }))).toEqual([
      { name: ada.name, emailAddress: ada.emailAddress, role: "administrator", status: "active" },
      { name: grace.name, emailAddress: grace.emailAddress, role: "member", status: "active" },
      { name: linus.name, emailAddress: linus.emailAddress, role: "member", status: "active" },
    ]);
    // The shared rooms by name, then the DMs in the order they were made, each naming who's in it when
    // it's for just them, and an open room being everyone's, which names nobody.
    expect(listed.rooms).toEqual([
      { id: roomNamed(listed, "general").id, kind: "open", name: "general", icon: null, createdAt: expect.any(String) },
      { id: launch.id, kind: "closed", name: "Launch", icon: null, createdAt: expect.any(String), memberIds: [graceSession.user.id, linusSession.user.id] },
      { id: roomNamed(listed, "random").id, kind: "open", name: "random", icon: null, createdAt: expect.any(String) },
      { id: together.id, kind: "direct", name: null, icon: null, createdAt: expect.any(String), memberIds: [graceSession.user.id, linusSession.user.id] },
      { id: toHerself.id, kind: "direct", name: null, icon: null, createdAt: expect.any(String), memberIds: [graceSession.user.id] },
    ]);
  });

  it("reads a room's messages a page at a time, whatever thread they're in or whether they've been deleted", async () => {
    const administrator = await setUp();
    const graceSession = await member(grace);
    const listed = (await (await listingOf(administrator.cookie)).json()) as ExportedListing;
    const general = roomNamed(listed, "general");
    const random = roomNamed(listed, "random");
    const adaTab = await connect(general.id, administrator);
    const graceTab = await connect(general.id, graceSession);

    const greeted = await post(adaTab, "Good morning");
    const planning = await post(adaTab, "Let's plan the launch");
    const threadOnly = await reply(graceTab, planning, "Only the thread hears me");
    const alsoSent = await reply(graceTab, planning, "The room hears me too", true);
    const edited = await post(adaTab, "Typo here");
    adaTab.send({ type: "message.update", messageId: edited.id, body: "Typo fixed" });
    expect((await updated(adaTab, edited.id)).message.plainText).toBe("Typo fixed");
    graceTab.send({ type: "boost.create", messageId: greeted.id, content: "🔥" });
    await graceTab.next("boost.created");
    // A deleted parent stays for its thread, which the export keeps with it.
    const kept = await post(adaTab, "Deleted, but its thread stays");
    const grieving = await reply(graceTab, kept, "So the message stays");
    adaTab.send({ type: "message.delete", messageId: kept.id });
    // Kept for its thread, the room says so by way of the message changing, not a deletion. The reply
    // changed it first, so the deletion's change is the second to arrive.
    for (;;) {
      const { message } = await adaTab.next("message.updated");
      if (message.id === kept.id && message.deleted) break;
    }

    const everyId = [greeted.id, planning.id, threadOnly.id, alsoSent.id, edited.id, kept.id, grieving.id];
    // Two at a time, pages small enough to walk the room with and come to its end.
    const walked: Message[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await roomStub(general.id).exportPage(general.id, after, 2);
      walked.push(...page.messages);
      const ids = page.messages.map(({ id }) => id);
      expect(ids, "each page in the order its messages came").toEqual([...ids].sort());
      if (!page.hasMore) break;
      after = page.messages.at(-1)!.id;
    }
    expect(walked.map(({ id }) => id)).toEqual(everyId);
    const byId = new Map(walked.map((message) => [message.id, message]));
    expect(byId.get(planning.id)).toMatchObject({ plainText: "Let's plan the launch", thread: { count: 2 } });
    expect(byId.get(threadOnly.id)).toMatchObject({ parentId: planning.id });
    expect(byId.get(threadOnly.id)?.alsoSent).toBe(false);
    expect(byId.get(alsoSent.id)).toMatchObject({ parentId: planning.id, alsoSent: true });
    expect(byId.get(edited.id)).toMatchObject({ plainText: "Typo fixed", editedAt: expect.any(String) });
    expect(byId.get(greeted.id)).toMatchObject({ boosts: [{ content: "🔥" }] });
    expect(byId.get(kept.id)).toMatchObject({ deleted: true, body: "", plainText: "" });
    expect(byId.get(grieving.id)).toMatchObject({ parentId: kept.id });

    // The endpoint answers the same, one page of the export's size, and an empty room, none.
    const first = (await (await pageOf(general.id, administrator.cookie)).json()) as ExportedMessages;
    expect(first).toEqual({ messages: walked, hasMore: false });
    expect(await (await pageOf(random.id, administrator.cookie)).json()).toEqual({ messages: [], hasMore: false });
  });

  it("reaches the DMs and closed rooms nobody has open, and takes an administrator to ask", async () => {
    const administrator = await setUp();
    const graceSession = await member(grace);
    const linusSession = await member(linus);
    const launch = await createRoom("Launch", { closedTo: [linusSession.user.id], as: graceSession });
    const together = await direct(graceSession, linusSession);
    const linusTab = await connect(together.id, linusSession);
    const whispered = await post(linusTab, "Between us");

    const pages = (await (await pageOf(together.id, administrator.cookie)).json()) as ExportedMessages;
    expect(pages.messages.map(({ id }) => id)).toEqual([whispered.id]);
    expect(await (await pageOf(launch.id, administrator.cookie)).json()).toEqual({ messages: [], hasMore: false });

    // Everyone else hears no, from the listing and from a room's messages alike, and nobody signed in does too.
    const refused = await pageOf(together.id, graceSession.cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "Only administrators can export the workspace" });
    expect((await listingOf(graceSession.cookie)).status).toBe(403);
    expect((await listingOf()).status).toBe(401);

    // Signing in with a password, as the script does, asks for what the administrator may.
    const signed = await signedIn(ada);
    expect(signed.status).toBe(201);
    expect(((await (await pageOf(launch.id, cookieOf(signed))).json()) as ExportedMessages).hasMore).toBe(false);
  });
});
