import { MAX_PINS, PINS_FULL, type ServerFrame } from "@ember/protocol";
import { describe, expect, it } from "vitest";
import { api, connect, forwardUpgrade, freshRoom, framesOf, post, settle, signIn } from "./support";

/** A socket from an address a ban blocks, which can read but change nothing. */
async function bannedReader(room: string) {
  const session = await signIn("Hal");
  const ws = ((await forwardUpgrade(room, { user: session.user, sessionId: "s1", authorizedAt: Date.now(), banned: true })).webSocket)!;
  ws.accept();
  return { ...framesOf<ServerFrame>(ws), ws, me: session.user, send: (frame: object) => ws.send(JSON.stringify(frame)) };
}

describe("Pin a message", () => {
  it("pins a message for everyone, attributed to whoever pinned it", async () => {
    const room = await freshRoom("pin");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const message = await post(ada, "Worth keeping");

    grace.send({ type: "pin.create", messageId: message.id });
    expect(await ada.next("pin.created")).toEqual({ type: "pin.created", messageId: message.id, by: grace.me, seq: 2 });
    expect(await grace.next("pin.created")).toEqual({ type: "pin.created", messageId: message.id, by: grace.me, seq: 2 });
  });

  it("ignores pinning a message that's pinned, as a repeated click", async () => {
    const room = await freshRoom("pin-repeat");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "Pinned once");
    ada.send({ type: "pin.create", messageId: message.id });
    await ada.next("pin.created");
    ada.send({ type: "pin.create", messageId: message.id });
    await settle(ada);
    expect(ada.log.filter((frame) => frame.type === "pin.created")).toHaveLength(1);
  });

  it("refuses to pin a message that doesn't exist", async () => {
    const ada = await connect(await freshRoom("pin-missing"), "Ada");
    ada.send({ type: "pin.create", messageId: "missing" });
    expect((await ada.next("error")).message).toBe("That message no longer exists");
  });

  it("lets anyone unpin, for everyone, numbering the change like a pin does", async () => {
    const room = await freshRoom("unpin");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const message = await post(ada, "Pinned, then not");
    grace.send({ type: "pin.create", messageId: message.id });
    await grace.next("pin.created");

    ada.send({ type: "pin.delete", messageId: message.id });
    expect(await ada.next("pin.deleted")).toEqual({ type: "pin.deleted", messageId: message.id, by: ada.me, seq: 3 });
    await grace.next("pin.deleted");
    grace.send({ type: "pins.list" });
    expect(await grace.next("pins.listed")).toEqual({ type: "pins.listed", pins: [] });
  });

  it("answers pins.list with the room's pins, oldest pinned first, with who pinned each and when", async () => {
    const room = await freshRoom("pins-list");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const first = await post(ada, "First pinned");
    grace.send({ type: "pin.create", messageId: first.id });
    await grace.next("pin.created");
    const second = await post(ada, "Second pinned");
    ada.send({ type: "pin.create", messageId: second.id });
    // Ada hears Grace's pin, then her own, one change after the other.
    await ada.next("pin.created");
    const { seq } = await ada.next("pin.created");
    expect(seq).toBe(4);

    grace.send({ type: "pins.list" });
    const listed = await grace.next("pins.listed");
    expect(listed.pins).toHaveLength(2);
    expect(listed.pins[0]).toMatchObject({ message: { id: first.id, body: first.body }, by: grace.me });
    expect(listed.pins[1]).toMatchObject({ message: { id: second.id }, by: ada.me });
    for (const pin of listed.pins) expect(pin!.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(listed.pins[0]!.at <= listed.pins[1]!.at).toBe(true);
  });

  it("names whoever pinned each under the name they have now", async () => {
    const room = await freshRoom("pins-names");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "Pinned by another name");
    ada.send({ type: "pin.create", messageId: message.id });
    await ada.next("pin.created");
    // Ada renames herself, as the profile page does.
    const renamed = await api("/api/users/me/profile", { method: "PATCH", headers: { Cookie: ada.session.cookie }, body: JSON.stringify({ name: "Ada King" }) });
    expect(renamed.status).toBe(200);

    ada.send({ type: "pins.list" });
    expect((await ada.next("pins.listed")).pins[0]).toMatchObject({ by: { id: ada.me.id, name: "Ada King" } });
  });
});

describe("A room's pins", () => {
  it(`holds at most ${MAX_PINS}, refusing the next with why`, async () => {
    const room = await freshRoom("pins-full");
    const ada = await connect(room, "Ada");
    const messages = [];
    for (let i = 0; i <= MAX_PINS; i++) messages.push(await post(ada, `Message ${i}`));
    for (const message of messages.slice(0, MAX_PINS)) {
      ada.send({ type: "pin.create", messageId: message.id });
      await ada.next("pin.created");
    }

    ada.send({ type: "pin.create", messageId: messages[MAX_PINS]!.id });
    expect(await ada.next("error")).toEqual({ type: "error", message: PINS_FULL, failed: "pin.create" });

    // Room for another once one is unpinned.
    ada.send({ type: "pin.delete", messageId: messages[0]!.id });
    await ada.next("pin.deleted");
    ada.send({ type: "pin.create", messageId: messages[MAX_PINS]!.id });
    expect((await ada.next("pin.created")).messageId).toBe(messages[MAX_PINS]!.id);
  });

  it("takes a deleted message's pin with it", async () => {
    const room = await freshRoom("pin-deleted");
    const ada = await connect(room, "Ada");
    const grace = await connect(room, "Grace");
    const message = await post(ada, "Pinned, then gone");
    ada.send({ type: "pin.create", messageId: message.id });
    await ada.next("pin.created");

    ada.send({ type: "message.delete", messageId: message.id });
    await grace.next("message.deleted");
    grace.send({ type: "pins.list" });
    expect(await grace.next("pins.listed")).toEqual({ type: "pins.listed", pins: [] });
  });
});

describe("What a ban blocks", () => {
  it("lets a banned address read the room's pins, but refuses to change them", async () => {
    const room = await freshRoom("pin-banned");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "Pinned while away");
    ada.send({ type: "pin.create", messageId: message.id });
    await ada.next("pin.created");

    const hal = await bannedReader(room);
    expect((await hal.next("welcome")).type).toBe("welcome");
    hal.send({ type: "pins.list" });
    expect((await hal.next("pins.listed")).pins).toHaveLength(1);
    hal.send({ type: "pin.create", messageId: message.id });
    expect(await hal.next("error")).toEqual({ type: "error", message: "Request failed (429)", failed: "pin.create" });
    hal.send({ type: "pin.delete", messageId: message.id });
    expect(await hal.next("error")).toEqual({ type: "error", message: "Request failed (429)", failed: "pin.delete" });
    await settle(ada);
    expect(ada.pending("pin.deleted")).toEqual([]);
  });
});
