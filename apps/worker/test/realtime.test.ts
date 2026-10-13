import { feature } from "@ember/parity";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { ChatRoom } from "../src/chat-room";
import type { Env } from "../src/env";
import { STORED_CLIENT_MESSAGE_IDS } from "../src/store";
import { connect, freshRoom, post, roomSql, roomStub, settle, signIn } from "./support";

const names = (users: { name: string }[]) => users.map((u) => u.name).sort();

describe(feature("realtime.presence"), () => {
  it("tells newcomers who is here and tells everyone else they arrived", async () => {
    const room = freshRoom("presence");
    const ada = await connect(room, "Ada");
    expect(names(ada.welcome.present)).toEqual(["Ada"]);

    const grace = await connect(room, "Grace");
    expect(names(grace.welcome.present)).toEqual(["Ada", "Grace"]);
    expect(await ada.next("presence.joined")).toEqual({ type: "presence.joined", user: grace.me });
  });

  it("tells everyone when someone leaves", async () => {
    const room = freshRoom("leave");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await ada.next("presence.joined");

    grace.close();
    expect(await ada.next("presence.left")).toEqual({ type: "presence.left", userId: grace.me.id });
  });

  it("counts someone with several tabs open once, until their last tab closes", async () => {
    const room = freshRoom("tabs");
    const ada = await connect(room, "Ada");
    const grace = await signIn("Grace");
    const firstTab = await connect(room, grace);
    const secondTab = await connect(room, grace);
    expect(names(secondTab.welcome.present)).toEqual(["Ada", "Grace"]);

    firstTab.close();
    // Closing one of her tabs only stops any typing in it.
    expect(await ada.next("typing")).toEqual({ type: "typing", user: grace.user, typing: false });
    secondTab.close();
    await ada.next("presence.left");
    expect(ada.log.filter((frame) => frame.type.startsWith("presence."))).toEqual([
      { type: "presence.joined", user: grace.user },
      { type: "presence.left", userId: grace.user.id },
    ]);
  });

  it("tells everyone when someone's connection drops without closing", async () => {
    const room = freshRoom("dropped");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await ada.next("presence.joined");

    // A connection that drops, like a phone losing signal, reaches the room as code 1006 with no
    // close frame to answer.
    await runInDurableObject((env as unknown as Env).CHAT_ROOM.getByName(room), async (instance: ChatRoom, state: DurableObjectState) => {
      const [socket] = state.getWebSockets(grace.me.id);
      await instance.webSocketClose(socket!, 1006);
    });
    expect(await ada.next("presence.left")).toEqual({ type: "presence.left", userId: grace.me.id });
  });
});

describe(feature("realtime.typing"), () => {
  it("tells everyone else when someone starts and stops typing", async () => {
    const room = freshRoom("typing");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");

    ada.send({ type: "typing.start" });
    expect(await grace.next("typing")).toEqual({ type: "typing", user: ada.me, typing: true });
    ada.send({ type: "typing.stop" });
    expect(await grace.next("typing")).toEqual({ type: "typing", user: ada.me, typing: false });

    await settle(ada);
    expect(ada.pending("typing")).toEqual([]);
  });

  it("lets someone's message say they've stopped typing, without a frame of its own", async () => {
    const room = freshRoom("typing-sent");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "typing.start" });
    await grace.next("typing");

    const message = await post(ada, "Done typing");
    expect((await grace.next("message.created")).message).toEqual(message);
    await settle(grace);
    expect(grace.pending("typing")).toEqual([]);
  });

  it("lets someone's leaving say they've stopped typing, without a frame of its own", async () => {
    const room = freshRoom("typing-left");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "typing.start" });
    await grace.next("typing");

    ada.close();
    expect(await grace.next("presence.left")).toEqual({ type: "presence.left", userId: ada.me.id });
    await settle(grace);
    expect(grace.pending("typing")).toEqual([]);
  });
});

describe(feature("realtime.reconnect"), () => {
  it("answers heartbeats, so clients can tell a dead connection from a quiet room", async () => {
    const ada = await connect(freshRoom("heartbeat"), "Ada");
    ada.sendRaw('{"type":"ping"}');
    expect(await ada.next("pong")).toEqual({ type: "pong" });
    ada.send({ type: "ping", extra: true });
    expect(await ada.next("pong")).toEqual({ type: "pong" });
  });

  it("catches a reconnecting client up on what it missed", async () => {
    const room = freshRoom("missed");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    grace.close();
    const missed = await post(ada, "While you were away");

    const back = await connect(room, grace.session);
    expect(back.welcome.messages).toContainEqual(missed);
    expect(back.me).toEqual(grace.me);
  });

  it("tells a sender which of their messages it stored", async () => {
    const room = freshRoom("checking");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await post(ada, "stored", "a1");
    await post(grace, "not Ada's", "g1");

    ada.send({ type: "message.check", clientMessageIds: ["a1", "g1", "lost"] });
    expect(await ada.next("message.checked")).toEqual({ type: "message.checked", stored: ["a1"], missing: ["g1", "lost"] });

    // On D1 every room's messages share one table, so the lookup has to stay in its own room.
    const elsewhere = await connect(freshRoom("checking-elsewhere"), ada.session);
    elsewhere.send({ type: "message.check", clientMessageIds: ["a1"] });
    expect(await elsewhere.next("message.checked")).toEqual({ type: "message.checked", stored: [], missing: ["a1"] });
  });

  it("checks a sender's messages through the room's index", async () => {
    const room = freshRoom("checking-plan");
    const ada = await connect(room, "Ada");
    const plan = await roomSql(room, `EXPLAIN QUERY PLAN ${STORED_CLIENT_MESSAGE_IDS}`, room, ada.me.id, '["c1"]');
    // Without it, a check reads every message in the room.
    expect(plan.map((row) => (row as { detail: string }).detail).join("; ")).toContain(
      "index_messages_on_room_id_and_client_message_id (room_id=? AND client_message_id=?)",
    );
  });

  it("names the messages it couldn't check", async () => {
    // Only a Durable Object's storage can be broken for one room without breaking the tests beside it.
    if ((env as { DB?: D1Database }).DB) return;
    const room = freshRoom("check-fails");
    const ada = await connect(room, "Ada");
    await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => {
      state.storage.sql.exec("ALTER TABLE messages RENAME TO messages_gone");
    });
    ada.send({ type: "message.check", clientMessageIds: ["a1", "a2"] });
    expect(await ada.next("error")).toMatchObject({ failed: "message.check", clientMessageIds: ["a1", "a2"] });
  });
});

describe(feature("platform.hibernation"), () => {
  it("keeps sockets, presence and who-said-what when the room hibernates", async () => {
    const room = freshRoom("hibernate");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await ada.next("presence.joined");

    await evictDurableObject((env as unknown as Env).CHAT_ROOM.getByName(room));

    const message = await post(ada, "After a nap");
    expect(message.creator).toEqual(ada.me);
    expect((await grace.next("message.created")).message).toEqual(message);
    grace.close();
    expect(await ada.next("presence.left")).toEqual({ type: "presence.left", userId: grace.me.id });
  });
});
