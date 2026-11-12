import type { RoomId } from "@ember/protocol";
import { EMPTY_CANVAS, roomTabPath, roomTabsPath, type OpenedTab } from "@ember/protocol/library";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { canvasEditing } from "../src/canvas-schema";
import { LET_GO_AFTER_MS, type CanvasSessions } from "../src/canvas-sessions";
import type { ChatRoom } from "../src/chat-room";
import { api, closeOf, connect, createRoom, freshDeploy, freshRoom, roomStub, signIn, type Client, type Session } from "./support";

// People writing a canvas together over the room's socket, the room's object applying their steps in turn
// (canvas-sessions.ts).

const asking = (session: Session, path: string, method = "GET", body?: unknown) =>
  api(path, { method, headers: { Cookie: session.cookie }, ...(body !== undefined && { body: JSON.stringify(body) }) });

async function ok<T>(response: Response, status = 200): Promise<T> {
  expect(response.status, await response.clone().text()).toBe(status);
  return response.json() as Promise<T>;
}

/** A new canvas in room `room`, by `as`. */
async function canvasIn(room: RoomId, as: Session): Promise<string> {
  return (await ok<OpenedTab>(await asking(as, roomTabsPath(room), "POST", { kind: "canvas", title: "Plan" }))).tab.id;
}

/** A step typing `text` at position `at`, as ProseMirror's JSON has it. */
const typing = (at: number, text: string) => ({ stepType: "replace", from: at, to: at, slice: { content: [{ type: "text", text }] } });

/** The text a canvas's document holds, by its JSON. */
const textOf = (body: string) => canvasEditing().docOf(body)!.textContent;

/** Starts writing canvas `tabId` on `client`, answering the canvas the room sends it. */
async function joining(client: Client, tabId: string) {
  client.send({ type: "canvas.join", tabId });
  return (await client.next("canvas.state")).canvas;
}

/** The canvas as the Workspace has saved it. */
const saved = async (as: Session, room: RoomId, tabId: string) => (await ok<OpenedTab>(await asking(as, roomTabPath(room, tabId)))).canvas!;

/** The canvases room `room`'s object holds in memory, with its alarm. */
const canvasesOf = (room: RoomId) =>
  runInDurableObject(roomStub(room), async (instance: ChatRoom, state: DurableObjectState) => ({
    canvases: (instance as unknown as { canvases: CanvasSessions | null }).canvases,
    alarm: await state.storage.getAlarm(),
  }));

/** Rings room `room`'s canvases as its alarm would at `now`, answering when they'd have it ring next. */
const ringAt = (room: RoomId, now: number) => runInDurableObject(roomStub(room), (instance: ChatRoom) => (instance as unknown as { canvases: CanvasSessions }).canvases.ring(now));

beforeEach(freshDeploy);

describe("Writing a canvas together", () => {
  it("applies each writer's steps in turn, sending them to everyone, and catches up a writer who was behind, so both converge", async () => {
    const room = await freshRoom("canvas-together");
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const tabId = await canvasIn(room, ada);
    const [adas, graces] = [await connect(room, ada), await connect(room, grace)];
    expect(await joining(adas, tabId)).toMatchObject({ body: EMPTY_CANVAS, version: 0 });
    expect(await joining(graces, tabId)).toMatchObject({ version: 0 });

    // Both type at once, over version 0: Ada's arrives first.
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [typing(1, "A")] });
    graces.send({ type: "canvas.steps", tabId, version: 0, clientId: "grace-1", steps: [typing(1, "G")] });
    const toAda = await adas.next("canvas.steps");
    expect(toAda).toMatchObject({ tabId, version: 0, steps: [typing(1, "A")], clientIds: ["ada-1"], updatedBy: { id: ada.user.id } });
    expect(await graces.next("canvas.steps")).toMatchObject({ version: 0, clientIds: ["ada-1"] });
    // Grace's went over a version she's past, so she hears what she missed, the step above again, and sends hers rebased.
    expect(await graces.next("canvas.steps")).toMatchObject({ version: 0, steps: [typing(1, "A")], clientIds: ["ada-1"] });
    graces.send({ type: "canvas.steps", tabId, version: 1, clientId: "grace-1", steps: [typing(2, "G")] });
    expect(await adas.next("canvas.steps")).toMatchObject({ version: 1, clientIds: ["grace-1"] });
    expect(await graces.next("canvas.steps")).toMatchObject({ version: 1, clientIds: ["grace-1"] });

    // Saved as the last of them leaves, not as they type.
    expect((await saved(ada, room, tabId)).version).toBe(0);
    adas.send({ type: "canvas.leave", tabId });
    graces.close();
    await expect.poll(async () => (await saved(ada, room, tabId)).version).toBe(2);
    expect(textOf((await saved(ada, room, tabId)).body)).toBe("AG");
  });

  it("saves a canvas and lets it go once writing stops, by the room's alarm, and loads it again for the next change", async () => {
    const room = await freshRoom("canvas-idle");
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const tabId = await canvasIn(room, ada);
    const [adas, graces] = [await connect(room, ada), await connect(room, grace)];
    await joining(adas, tabId);
    await joining(graces, tabId);
    const typedAt = Date.now();
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [typing(1, "Hi")] });
    await adas.next("canvas.steps");
    await graces.next("canvas.steps");

    // The alarm, not a timer, comes back for it, and while the writing is recent it only rings again.
    const writing = await canvasesOf(room);
    expect(writing.canvases?.holds(tabId)).toBe(true);
    expect(writing.alarm).toBeGreaterThanOrEqual(typedAt + LET_GO_AFTER_MS);
    expect(writing.alarm).toBeLessThanOrEqual(Date.now() + LET_GO_AFTER_MS);
    expect(await runDurableObjectAlarm(roomStub(room))).toBe(true);
    expect((await canvasesOf(room)).canvases?.holds(tabId)).toBe(true);
    expect((await saved(ada, room, tabId)).version).toBe(0);

    // Once it's quiet, the canvas is saved and nothing of it is left in memory, so the object can hibernate.
    expect(await ringAt(room, Date.now() + LET_GO_AFTER_MS)).toBeNull();
    expect((await canvasesOf(room)).canvases?.holds(tabId)).toBe(false);
    expect(textOf((await saved(ada, room, tabId)).body)).toBe("Hi");
    expect((await saved(ada, room, tabId)).version).toBe(1);

    // The next change loads it from the Workspace, and goes on from the version both writers have.
    graces.send({ type: "canvas.steps", tabId, version: 1, clientId: "grace-1", steps: [typing(3, "!")] });
    expect(await adas.next("canvas.steps")).toMatchObject({ version: 1, clientIds: ["grace-1"] });
    expect(await graces.next("canvas.steps")).toMatchObject({ version: 1, clientIds: ["grace-1"] });
    expect((await canvasesOf(room)).canvases?.holds(tabId)).toBe(true);
    expect(await ringAt(room, Date.now() + LET_GO_AFTER_MS)).toBeNull();
    expect(textOf((await saved(ada, room, tabId)).body)).toBe("Hi!");
  });

  it("sends a writer who connects again the steps they missed, or the canvas whole once it can't", async () => {
    const room = await freshRoom("canvas-catch-up");
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const tabId = await canvasIn(room, ada);
    const adas = await connect(room, ada);
    await joining(adas, tabId);
    const graces = await connect(room, grace);
    await joining(graces, tabId);
    graces.close();
    for (const [version, text] of ["a", "b", "c"].entries()) {
      adas.send({ type: "canvas.steps", tabId, version, clientId: "ada-1", steps: [typing(version + 1, text)] });
      await adas.next("canvas.steps");
    }

    const again = await connect(room, grace);
    again.send({ type: "canvas.join", tabId, version: 1 });
    expect(await again.next("canvas.steps")).toMatchObject({ version: 1, steps: [typing(2, "b"), typing(3, "c")], clientIds: ["ada-1", "ada-1"] });
    // A version the room has no record of is answered with the canvas as it is.
    again.send({ type: "canvas.join", tabId, version: 99 });
    expect(textOf((await again.next("canvas.state")).canvas.body)).toBe("abc");
  });

  it("cuts off someone taken out of the room at once, so nothing more of theirs reaches the canvas", async () => {
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const room = (await createRoom("canvas-private", { closedTo: [ada.user.id, grace.user.id], as: ada })).id;
    const tabId = await canvasIn(room, ada);
    const [adas, graces] = [await connect(room, ada), await connect(room, grace)];
    await joining(adas, tabId);
    await joining(graces, tabId);
    const closed = closeOf(graces.ws);

    const takenOut = await asking(ada, `/api/rooms/${room}`, "PATCH", { kind: "closed", memberIds: [ada.user.id] });
    expect(takenOut.status).toBe(200);
    await closed;
    // Her socket is gone, and a new one isn't let in; nor can she save the canvas whole.
    expect((await api(`/api/rooms/${room}/socket`, { headers: { Upgrade: "websocket", Cookie: grace.cookie } })).status).toBe(404);
    expect((await asking(grace, `${roomTabPath(room, tabId)}/canvas`, "PUT", { body: EMPTY_CANVAS, version: 0 })).status).toBe(404);

    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [typing(1, "still mine")] });
    expect(await adas.next("canvas.steps")).toMatchObject({ version: 0, clientIds: ["ada-1"] });
  });

  it("lets a socket write only its own room's canvases, and only once it's joined one", async () => {
    const [ada] = [await signIn("Ada")];
    const [room, other] = [await freshRoom("canvas-here"), await freshRoom("canvas-there")];
    const elsewhere = await canvasIn(other, ada);
    const adas = await connect(room, ada);
    adas.send({ type: "canvas.join", tabId: elsewhere });
    expect(await adas.next("canvas.refused")).toMatchObject({ tabId: elsewhere, message: "That canvas isn't there anymore" });
    adas.send({ type: "canvas.steps", tabId: elsewhere, version: 0, clientId: "ada-1", steps: [typing(1, "x")] });
    expect(await adas.next("canvas.refused")).toMatchObject({ tabId: elsewhere });
    expect((await saved(ada, other, elsewhere)).body).toBe(EMPTY_CANVAS);
  });

  it("refuses steps that aren't steps or don't apply, sending the canvas as it is", async () => {
    const room = await freshRoom("canvas-refused");
    const ada = await signIn("Ada");
    const tabId = await canvasIn(room, ada);
    const adas = await connect(room, ada);
    await joining(adas, tabId);
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [typing(40, "out of range")] });
    expect(await adas.next("canvas.refused")).toMatchObject({ message: "That change couldn't be made to the canvas" });
    expect((await adas.next("canvas.state")).canvas).toMatchObject({ body: EMPTY_CANVAS, version: 0 });
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "iframe" }] } }] });
    expect(await adas.next("canvas.refused")).toMatchObject({ tabId });
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [] });
    expect(await adas.next("error")).toMatchObject({ message: "Unrecognized frame" });
  });

  it("takes a canvas saved whole while people write it as one change of theirs, which they hear, refusing one over an older version", async () => {
    const room = await freshRoom("canvas-whole");
    const [ada, grace] = [await signIn("Ada"), await signIn("Grace")];
    const tabId = await canvasIn(room, ada);
    const adas = await connect(room, ada);
    await joining(adas, tabId);
    adas.send({ type: "canvas.steps", tabId, version: 0, clientId: "ada-1", steps: [typing(1, "Hello")] });
    await adas.next("canvas.steps");

    const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello there" }] }] });
    const whole = await ok<OpenedTab>(await asking(grace, `${roomTabPath(room, tabId)}/canvas`, "PUT", { body, version: 1 }));
    expect(whole.canvas).toMatchObject({ version: 2, updatedBy: { id: grace.user.id } });
    expect(await adas.next("canvas.steps")).toMatchObject({ version: 1, updatedBy: { id: grace.user.id } });
    expect(textOf((await saved(ada, room, tabId)).body)).toBe("Hello there");

    const stale = await asking(grace, `${roomTabPath(room, tabId)}/canvas`, "PUT", { body: EMPTY_CANVAS, version: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ canvas: { version: 2 } });
  });
});
