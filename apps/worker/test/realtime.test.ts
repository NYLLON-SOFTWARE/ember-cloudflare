import { feature } from "@ember/parity";
import { evictDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { connect, freshRoom, post, settle, signIn } from "./support";

const names = (users: { name: string }[]) => users.map((u) => u.name).sort();

describe(feature("realtime.presence"), () => {
  it("tells newcomers who is here and tells everyone else they arrived", async () => {
    const room = freshRoom("presence");
    const ada = await connect(room, "Ada");
    expect(names(ada.welcome.present)).toEqual(["Ada"]);

    const grace = await connect(room, "Grace");
    expect(names(grace.welcome.present)).toEqual(["Ada", "Grace"]);
    expect(names((await ada.next("presence")).present)).toEqual(["Ada", "Grace"]);
  });

  it("tells everyone when someone leaves", async () => {
    const room = freshRoom("leave");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await ada.next("presence");

    grace.close();
    expect(names((await ada.next("presence")).present)).toEqual(["Ada"]);
  });

  it("counts someone with several tabs open once, until their last tab closes", async () => {
    const room = freshRoom("tabs");
    const ada = await connect(room, "Ada");
    const grace = await signIn("Grace");
    const firstTab = await connect(room, grace);
    const secondTab = await connect(room, grace);
    expect(names(secondTab.welcome.present)).toEqual(["Ada", "Grace"]);
    await ada.next("presence"); // Grace's first tab arriving
    await ada.next("presence"); // and her second

    firstTab.close();
    expect(names((await ada.next("presence")).present)).toEqual(["Ada", "Grace"]);
    secondTab.close();
    expect(names((await ada.next("presence")).present)).toEqual(["Ada"]);
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

  it("stops showing someone as typing once their message arrives", async () => {
    const room = freshRoom("typing-sent");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "typing.start" });
    await grace.next("typing");

    await post(ada, "Done typing");
    expect(await grace.next("typing")).toEqual({ type: "typing", user: ada.me, typing: false });
  });

  it("stops showing someone as typing when they leave", async () => {
    const room = freshRoom("typing-left");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    ada.send({ type: "typing.start" });
    await grace.next("typing");

    ada.close();
    expect(await grace.next("typing")).toEqual({ type: "typing", user: ada.me, typing: false });
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

    const back = await connect(room, { token: grace.token });
    expect(back.welcome.messages).toContainEqual(missed);
    expect(back.me).toEqual(grace.me);
  });
});

describe(feature("platform.hibernation"), () => {
  it("keeps sockets, presence and who-said-what when the room hibernates", async () => {
    const room = freshRoom("hibernate");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    await ada.next("presence");

    await evictDurableObject((env as unknown as Env).CHAT_ROOM.getByName(room));

    const message = await post(ada, "After a nap");
    expect(message.creator).toEqual(ada.me);
    expect((await grace.next("message.created")).message).toEqual(message);
    grace.close();
    expect(names((await ada.next("presence")).present)).toEqual(["Ada"]);
  });
});
