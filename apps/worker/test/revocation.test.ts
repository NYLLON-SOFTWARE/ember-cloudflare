import { feature } from "@ember/parity";
import { CloseCode, type RoomId } from "@ember/protocol";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { AUTHORIZATION_TTL_MS, EVERYONE, REVOCATIONS_KEPT_MS, sessionTag, type Revocation } from "../src/revocations";
import type { Workspace } from "../src/workspace";
import { DUE_REVOCATIONS, type WorkspaceStore } from "../src/workspace-store";
import { closeOf, connect, forwardUpgrade, freshDeploy, freshRoom, post, roomSql, roomStub, settle, signIn, workspaceSql, workspaceStub, type Access } from "./support";

/** A time so far ahead that the runtime never runs an alarm set for it during a test. */
const LATER = Date.now() + 365 * 24 * 60 * 60 * 1000;

/**
 * What a socket the Worker sends on to the room comes to: let in and welcomed, or closed at once,
 * with a code and reason. A socket let in is closed again once it's welcomed.
 */
async function outcome(room: RoomId, access: Access): Promise<"welcome" | { code: number; reason: string }> {
  const ws = (await forwardUpgrade(room, access)).webSocket!;
  ws.accept();
  let welcomed = false;
  ws.addEventListener("message", (event) => {
    welcomed = (JSON.parse(event.data as string) as { type: string }).type === "welcome";
    ws.close(1000);
  });
  const { code, reason } = await closeOf(ws);
  return welcomed ? "welcome" : { code, reason };
}

const reconnect = { code: CloseCode.Reconnect, reason: "Reconnect" };

/** Queues a revocation in the Workspace's outbox, as a change that ends someone's access does. */
const queue = (roomId: string, tag: string, code: CloseCode, dueAt: number) =>
  workspaceSql("INSERT INTO pending_revocations (room_id, tag, code, due_at) VALUES (?, ?, ?, ?)", roomId, tag, code, dueAt);

const waiting = () => workspaceSql("SELECT room_id, tag, attempts, due_at FROM pending_revocations ORDER BY id");

const alarm = () => runInDurableObject(workspaceStub(), (_workspace, state: DurableObjectState) => state.storage.getAlarm());

/** What the Workspace's alarm calls, standing in for each room. */
interface Rooms {
  revoke(roomId: RoomId, revocations: Revocation[], revokedAt: number): Promise<void>;
}

/** Runs the Workspace's alarm, as the runtime does once it's due, with `rooms` answering for the rooms. */
async function runAlarm(rooms: Rooms): Promise<void> {
  await runInDurableObject(workspaceStub(), async (workspace: Workspace, state: DurableObjectState) => {
    // The runtime clears an alarm as it runs it.
    await state.storage.deleteAlarm();
    const object = workspace as unknown as { env: Env };
    const env = object.env;
    object.env = { ...env, CHAT_ROOM: { getByName: () => rooms } as unknown as Env["CHAT_ROOM"] };
    try {
      await workspace.alarm();
    } finally {
      object.env = env;
    }
  });
}

beforeEach(freshDeploy);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe(feature("realtime.connection"), () => {
  it("turns away a socket let through at or before a revocation of its session or person, telling it to reconnect", async () => {
    const room = await freshRoom("lobby");
    const ada = await signIn("Ada");
    const revokedAt = Date.now();
    await roomStub(room).revoke(room, [{ tag: sessionTag("laptop"), code: CloseCode.Reconnect }], revokedAt);

    const laptop = (authorizedAt: number) => ({ user: ada.user, sessionId: "laptop", authorizedAt });
    expect(await outcome(room, laptop(revokedAt - 1))).toEqual(reconnect);
    expect(await outcome(room, laptop(revokedAt))).toEqual(reconnect);
    expect(await outcome(room, laptop(revokedAt + 1))).toBe("welcome");
    // The person's other sessions weren't revoked.
    expect(await outcome(room, { user: ada.user, sessionId: "phone", authorizedAt: revokedAt - 1 })).toBe("welcome");

    await roomStub(room).revoke(room, [{ tag: ada.user.id, code: CloseCode.Revoked }], revokedAt + 1);
    expect(await outcome(room, { user: ada.user, sessionId: "phone", authorizedAt: revokedAt + 1 })).toEqual(reconnect);
    expect(await outcome(room, { user: ada.user, sessionId: "phone", authorizedAt: revokedAt + 2 })).toBe("welcome");
  });

  it("turns away a socket let through over a minute before it arrives, which a revocation may have outlived", async () => {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now });
    const room = await freshRoom("lobby");
    const { user } = await signIn("Ada");
    expect(await outcome(room, { user, sessionId: "laptop", authorizedAt: now - AUTHORIZATION_TTL_MS - 1 })).toEqual(reconnect);
    expect(await outcome(room, { user, sessionId: "laptop", authorizedAt: now - AUTHORIZATION_TTL_MS })).toBe("welcome");
  });

  it("keeps its revocations when it's evicted, and forgets them once no authorization could be that old", async () => {
    const start = Date.now();
    vi.useFakeTimers({ toFake: ["Date"], now: start });
    const room = await freshRoom("lobby");
    const { user } = await signIn("Ada");
    await roomStub(room).revoke(room, [{ tag: user.id, code: CloseCode.Revoked }], start);

    await evictDurableObject(roomStub(room));
    expect(await outcome(room, { user, sessionId: "laptop", authorizedAt: start })).toEqual(reconnect);

    vi.setSystemTime(start + REVOCATIONS_KEPT_MS + 1);
    await roomStub(room).revoke(room, [{ tag: "someone-else", code: CloseCode.Revoked }], start + REVOCATIONS_KEPT_MS + 1);
    expect(await roomSql(room, "SELECT tag FROM revocations WHERE room_id = ?", room)).toEqual([{ tag: "someone-else" }]);
  });

  it("closes every socket a revocation names with its code, and the person leaves at once, just once", async () => {
    const room = await freshRoom("lobby");
    const grace = await connect(room, "Grace");
    const ada = await signIn("Ada");
    const tabs = [await connect(room, ada), await connect(room, ada)];
    const linus = await connect(room, "Linus");
    await settle(grace);
    const closes = tabs.map((tab) => closeOf(tab.ws));

    await roomStub(room).revoke(room, [{ tag: ada.user.id, code: CloseCode.Revoked }], Date.now());
    for (const close of await Promise.all(closes)) expect(close).toMatchObject({ code: CloseCode.Revoked, reason: "Revoked" });
    expect(await grace.next("presence.left")).toEqual({ type: "presence.left", userId: ada.user.id });

    // Everyone else carries on, and hears it once, though Ada's app answers the close after.
    expect((await post(linus, "Still here")).body).toBe("Still here");
    await settle(grace, linus);
    expect(grace.log.filter((frame) => frame.type === "presence.left")).toHaveLength(1);
    expect(linus.log.filter((frame) => frame.type === "presence.left")).toHaveLength(1);
  });

  it("ignores what a socket sent before it heard it was closed", async () => {
    const room = await freshRoom("lobby");
    const grace = await connect(room, "Grace");
    const ada = await connect(room, "Ada");
    await roomStub(room).revoke(room, [{ tag: ada.me.id, code: CloseCode.Revoked }], Date.now());
    ada.send({ type: "message.create", clientMessageId: "late", body: "Sent before I heard" });
    ada.send({ type: "typing.start" });

    await settle(grace);
    expect(grace.log.filter((frame) => frame.type === "message.created" || frame.type === "typing")).toEqual([]);
    expect(await roomSql(room, "SELECT count(*) AS n FROM messages WHERE room_id = ?", room)).toEqual([{ n: 0 }]);
  });

  it("queues closing a session's sockets in each of its person's rooms, in the change that ends it", async () => {
    const ada = await signIn("Ada");
    const rooms = [await freshRoom("lobby"), await freshRoom("annex")];
    const [{ id, token_digest }] = (await workspaceSql("SELECT id, token_digest FROM sessions WHERE user_id = ?", ada.user.id)) as [{ id: string; token_digest: string }];
    const endSession = () =>
      runInDurableObject(workspaceStub(), (workspace: Workspace) =>
        (workspace as unknown as { store: WorkspaceStore }).store.endSession(token_digest, CloseCode.Reconnect, LATER),
      );

    expect(await endSession()).toEqual({ queued: true, sessionId: id });
    expect(await workspaceSql("SELECT room_id, tag, code, attempts, due_at FROM pending_revocations ORDER BY room_id")).toEqual(
      rooms.sort().map((room_id) => ({ room_id, tag: `s:${id}`, code: CloseCode.Reconnect, attempts: 0, due_at: LATER })),
    );
    expect(await workspaceSql("SELECT id FROM sessions WHERE user_id = ?", ada.user.id)).toEqual([]);
    // Nothing more once it has ended.
    expect(await endSession()).toEqual({ queued: false, sessionId: null });
  });

  it("delivers each room's revocations in one call, as of when it read them, and leaves the rest for later", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    await queue("lobby", "u1", CloseCode.Revoked, LATER);
    await queue("annex", "u1", CloseCode.Revoked, LATER);
    await queue("lobby", "s:laptop", CloseCode.Reconnect, LATER);
    await queue("lobby", "u2", CloseCode.Revoked, LATER + 1);
    const calls: unknown[] = [];

    await runAlarm({ revoke: async (...call) => void calls.push(call) });
    expect(calls).toEqual([
      [
        "lobby",
        [
          { tag: "u1", code: CloseCode.Revoked },
          { tag: "s:laptop", code: CloseCode.Reconnect },
        ],
        LATER,
      ],
      ["annex", [{ tag: "u1", code: CloseCode.Revoked }], LATER],
    ]);
    expect(await waiting()).toEqual([{ room_id: "lobby", tag: "u2", attempts: 0, due_at: LATER + 1 }]);
    expect(await alarm()).toBe(LATER + 1);
  });

  it("tries a room it can't reach again, waiting twice as long each time, and gives up after ten tries", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await queue("lobby", "u1", CloseCode.Revoked, LATER);
    await queue("annex", "u1", CloseCode.Revoked, LATER);
    const calls: RoomId[] = [];
    const rooms: Rooms = {
      revoke: async (roomId) => {
        calls.push(roomId);
        if (roomId === "lobby") throw new Error("The lobby isn't answering");
      },
    };

    let now = LATER;
    for (let tries = 1; tries < 10; tries++) {
      await runAlarm(rooms);
      const wait = 1000 * 2 ** (tries - 1);
      expect(await waiting()).toEqual([{ room_id: "lobby", tag: "u1", attempts: tries, due_at: now + wait }]);
      expect(await alarm()).toBe(now + wait);
      // Not before then.
      vi.setSystemTime((now += wait) - 1);
      await runAlarm(rooms);
      vi.setSystemTime(now);
    }
    await runAlarm(rooms);
    expect(calls).toEqual(["lobby", "annex", ...Array<RoomId>(9).fill("lobby")]);
    expect(await waiting()).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(11);
    expect(errors).toHaveBeenLastCalledWith("Gave up closing the sockets tagged u1 in room lobby");
  });

  it("delivers 40 revocations a run, calling six rooms at once, and sets its alarm for the rest", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    const ids = Array.from({ length: 45 }, (_, i) => `room-${String(i).padStart(2, "0")}`);
    await workspaceSql(
      "INSERT INTO pending_revocations (room_id, tag, code, due_at) SELECT value, 'u1', ?, ? FROM json_each(?)",
      CloseCode.Revoked,
      LATER,
      JSON.stringify(ids),
    );
    const calls: RoomId[] = [];
    let open = 0;
    let most = 0;
    const rooms: Rooms = {
      revoke: async (roomId) => {
        calls.push(roomId);
        most = Math.max(most, ++open);
        await scheduler.wait(1);
        open--;
      },
    };

    await runAlarm(rooms);
    expect(calls).toEqual(ids.slice(0, 40));
    expect(most).toBe(6);
    expect(await alarm()).toBe(LATER);
    await runAlarm(rooms);
    expect(calls).toEqual(ids);
    expect(await waiting()).toEqual([]);
  });

  it("sets its alarm for the revocations waiting when it starts, in case it stopped before it could", async () => {
    const ada = await signIn("Ada");
    const lobby = await freshRoom("lobby");
    const closed = closeOf((await connect(lobby, ada)).ws);
    // As a Workspace that stopped between saving a change and setting its alarm leaves it.
    await queue(lobby, ada.user.id, CloseCode.Reconnect, Date.now());
    expect(await alarm()).toBeNull();

    await evictDurableObject(workspaceStub());
    // Anything that reaches the Workspace starts it again.
    await alarm();
    expect(await closed).toMatchObject(reconnect);
  });

  it("finds the revocations that are due by their index, however many are waiting", async () => {
    const plan = (await workspaceSql(`EXPLAIN QUERY PLAN ${DUE_REVOCATIONS}`, 0, 40)).map((row) => (row as { detail: string }).detail).join("; ");
    expect(plan).toContain("USING INDEX index_pending_revocations_on_due_at (due_at<?)");
    expect(plan).not.toContain("TEMP B-TREE");
  });
});

describe(feature("rooms.delete"), () => {
  it("never gives up deleting a room it can't reach, trying again at the longest wait until it can", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: LATER });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await queue("lobby", EVERYONE, CloseCode.NotFound, LATER);
    let reachable = false;
    const calls: unknown[] = [];
    const rooms: Rooms = {
      revoke: async (...call) => {
        calls.push(call);
        if (!reachable) throw new Error("The lobby isn't answering");
      },
    };

    let now = LATER;
    for (let tries = 1; tries <= 12; tries++) {
      await runAlarm(rooms);
      const wait = Math.min(1000 * 2 ** (tries - 1), 5 * 60 * 1000);
      expect(await waiting()).toEqual([{ room_id: "lobby", tag: EVERYONE, attempts: tries, due_at: now + wait }]);
      expect(await alarm()).toBe(now + wait);
      vi.setSystemTime((now += wait));
    }
    // However often it has failed.
    await workspaceSql("UPDATE pending_revocations SET attempts = 100");
    await runAlarm(rooms);
    expect(await waiting()).toEqual([{ room_id: "lobby", tag: EVERYONE, attempts: 101, due_at: now + 5 * 60 * 1000 }]);
    vi.setSystemTime((now += 5 * 60 * 1000));

    reachable = true;
    await runAlarm(rooms);
    expect(calls).toHaveLength(14);
    expect(calls.at(-1)).toEqual(["lobby", [{ tag: EVERYONE, code: CloseCode.NotFound }], now]);
    expect(await waiting()).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(13);
    expect(errors).not.toHaveBeenCalledWith(expect.stringMatching(/^Gave up/));
  });
});
