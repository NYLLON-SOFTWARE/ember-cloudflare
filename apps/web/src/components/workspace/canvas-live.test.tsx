import { MAX_ROOM_FRAME_SIZE, type ClientFrame, type Me, type Room, type ServerFrame, type User } from "@ember/protocol";
import { EMPTY_CANVAS, type Canvas, type OpenedTab } from "@ember/protocol/library";
import type { Editor } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { act, render, screen, waitFor } from "@testing-library/react";
import { collab, sendableSteps } from "prosemirror-collab";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomFrames } from "@/hooks/use-room";
import { canvasExtensions } from "../../../../worker/src/canvas-schema";
import { CanvasSessions } from "../../../../worker/src/canvas-sessions";
import { CanvasEditor } from "./canvas-editor";
import { fromRoom } from "./canvas-live";
import { RoomFramesContext } from "./room-tab-icons";

// Two editors writing one canvas through a room that runs the room object's own canvas sessions, over
// sockets that can go away and come back.

const maya: Me = { id: "maya", name: "Maya", administrator: false };
const sam: Me = { id: "sam", name: "Sam", administrator: false };
const room: Room = { id: "design", name: "design", kind: "open", icon: null };
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

/** A socket to the room, which hears what it's sent once the room sends it, and can go away. */
class Socket {
  readonly listeners = new Set<(frame: ServerFrame) => void>();
  open = true;
  /** How long a frame takes each way, in milliseconds. */
  latency = 0;
  /** How often the room has closed it over a frame too big to read, as it does, the socket coming back soon after. */
  closedTooBig = 0;
  constructor(
    readonly room: FakeRoom,
    readonly user: User,
  ) {}
  private later(work: () => void) {
    if (this.latency > 0) setTimeout(work, this.latency);
    else queueMicrotask(work);
  }
  deliver(frame: ServerFrame) {
    if (this.open) this.later(() => act(() => this.listeners.forEach((listener) => listener(frame))));
  }
  readonly frames: RoomFrames = {
    send: (frame: ClientFrame) => {
      if (!this.open) return false;
      if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > MAX_ROOM_FRAME_SIZE) {
        this.closedTooBig++;
        this.open = false;
        setTimeout(() => this.reconnect(), 20);
        return true;
      }
      if (this.latency > 0) this.later(() => void this.room.handle(this, frame));
      else void this.room.handle(this, frame);
      return true;
    },
    listen: (listener) => {
      this.listeners.add(listener);
      return () => void this.listeners.delete(listener);
    },
  };
  /** Comes back, as the room welcomes a socket that connects again. */
  reconnect() {
    this.open = true;
    this.deliver({ type: "welcome", you: this.user, present: [], seq: 0, messages: [], hasMore: false, hasNewer: false, around: null });
  }
}

/** A room as its object handles canvas frames, with the Workspace's saved canvas beside it. */
class FakeRoom {
  writing = new Map<Socket, string>();
  saved: Canvas = { body: EMPTY_CANVAS, version: 0, updatedAt: "2026-11-12T10:00:00.000Z", updatedBy: maya };
  private queue: Promise<unknown> = Promise.resolve();
  sessions: CanvasSessions = this.restart();

  /** Starts afresh, as the object does when the runtime restarts it, with only what the Workspace saved. */
  restart(): CanvasSessions {
    this.sessions = new CanvasSessions({
      roomId: room.id,
      writers: (tabId) => [...this.writing].filter(([socket, writing]) => socket.open && writing === tabId).map(([socket]) => socket as unknown as WebSocket),
      send: (ws, frame) => (ws as unknown as Socket).deliver(frame),
      // No alarm here: the room's tests ring it.
      ringBy: async () => {},
      load: async () => this.saved,
      keep: async (_tabId, body, version, by) => {
        this.saved = { body, version, updatedBy: by, updatedAt: new Date().toISOString() };
        return true;
      },
      save: async () => "not found",
    });
    return this.sessions;
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  handle(socket: Socket, frame: ClientFrame) {
    const ws = socket as unknown as WebSocket;
    return this.serially(async () => {
      if (frame.type === "canvas.join") {
        this.writing.set(socket, frame.tabId);
        await this.sessions.join(ws, frame.tabId, frame.version);
      } else if (frame.type === "canvas.steps") await this.sessions.apply(ws, socket.user, frame.tabId, frame.version, frame.clientId, frame.steps);
      else if (frame.type === "canvas.leave") {
        this.writing.delete(socket);
        await this.sessions.left(frame.tabId);
      }
    });
  }
}

const opened: OpenedTab = {
  tab: { id: "t1", roomId: room.id, kind: "canvas", title: "Plan", creator: maya, createdAt: "2026-11-12T09:00:00.000Z", updatedAt: "2026-11-12T09:00:00.000Z" },
  canvas: { body: EMPTY_CANVAS, version: 0, updatedAt: "2026-11-12T09:00:00.000Z", updatedBy: maya },
};

/** Maya's and Sam's editors on the canvas, each over a socket of their own. */
function writeTogether(fake = new FakeRoom()) {
  const sockets = [new Socket(fake, maya), new Socket(fake, sam)] as const;
  const { unmount } = render(
    <>
      {sockets.map((socket) => (
        <RoomFramesContext key={socket.user.id} value={socket.frames}>
          <CanvasEditor room={room} me={socket.user as Me} opened={opened} onSaved={vi.fn()} onFailed={vi.fn()} />
        </RoomFramesContext>
      ))}
    </>,
  );
  const editors = () => [...document.querySelectorAll<HTMLElement & { editor: Editor }>(".ProseMirror")].map((element) => element.editor);
  return { fake, sockets, editors, unmount };
}

/** Types `text` as a paragraph at the end of `editor`'s canvas. */
const typeAtEnd = (editor: Editor, text: string) => act(() => void editor.commands.insertContentAt(editor.state.doc.content.size, paragraph(text)));

afterEach(() => vi.restoreAllMocks());

describe("Writing a canvas together", () => {
  it("brings both editors to the same canvas as two people type at once, which the room saves as they close it", async () => {
    const { fake, editors, unmount } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    typeAtEnd(mayas!, "MAYA");
    typeAtEnd(sams!, "SAM");
    await waitFor(() => expect(mayas!.getText()).toBe(sams!.getText()), { timeout: 3000 });
    expect(mayas!.getText()).toContain("MAYA");
    expect(mayas!.getText()).toContain("SAM");
    unmount();
    await waitFor(() => expect(fake.saved.version).toBeGreaterThan(0));
  });

  it("catches an editor whose socket went away up with what it missed, and sends what it wrote meanwhile", async () => {
    const { sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    sockets[1].open = false;
    typeAtEnd(mayas!, "WHILE SAM WAS AWAY");
    typeAtEnd(sams!, "SAM OFFLINE");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mayas!.getText()).not.toContain("SAM OFFLINE");
    sockets[1].reconnect();
    await waitFor(() => expect(sams!.getText()).toBe(mayas!.getText()), { timeout: 3000 });
    expect(sams!.getText()).toContain("WHILE SAM WAS AWAY");
    expect(sams!.getText()).toContain("SAM OFFLINE");
  });

  it("merges what's written here into the canvas the room sends whole, as one that restarted behind it does", async () => {
    const { fake, sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    typeAtEnd(mayas!, "SAVED");
    await waitFor(() => expect(sams!.getText()).toContain("SAVED"));
    typeAtEnd(mayas!, "ALSO HEARD");
    await waitFor(() => expect(sams!.getText()).toContain("ALSO HEARD"));
    // The room restarts having saved only Maya's first change, behind what Sam's editor has heard.
    const sent = vi.spyOn(sockets[1].frames, "send");
    sockets[0].open = false;
    sockets[1].open = false;
    fake.saved = { ...fake.saved, body: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }, paragraph("SAVED")] }), version: 1 };
    fake.restart();
    typeAtEnd(sams!, "SAM OFFLINE");
    sockets[1].reconnect();
    await waitFor(() => expect(sent).toHaveBeenCalledWith({ type: "canvas.join", tabId: "t1", version: 2 }));
    await waitFor(() => expect(fake.sessions["sessions"].get("t1")?.doc.textContent).toContain("SAM OFFLINE"), { timeout: 3000 });
    expect(sams!.getText()).toContain("SAVED");
    expect(sams!.getText()).toContain("SAM OFFLINE");
  });

  it("keeps what the room confirmed but hadn't saved when it restarts, sending it back to the room behind it", async () => {
    const { fake, sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    typeAtEnd(mayas!, "CONFIRMED");
    await waitFor(() => expect(sams!.getText()).toContain("CONFIRMED"));
    // The room restarts before saving, with only the canvas as it opened, and Maya has nothing left to send.
    sockets[0].open = false;
    sockets[1].open = false;
    fake.restart();
    sockets[0].reconnect();
    await waitFor(() => expect(fake.sessions["sessions"].get("t1")?.doc.textContent).toContain("CONFIRMED"), { timeout: 3000 });
    expect(mayas!.getText()).toContain("CONFIRMED");
    sockets[1].reconnect();
    await waitFor(() => expect(sams!.getText()).toBe(mayas!.getText()), { timeout: 3000 });
    expect(sams!.getText().match(/CONFIRMED/g)).toHaveLength(1);
  });

  it("sends what was written while the socket was away once it's back, though the canvas has closed meanwhile", async () => {
    const fake = new FakeRoom();
    const socket = new Socket(fake, maya);
    const { unmount } = render(
      <RoomFramesContext value={socket.frames}>
        <CanvasEditor room={room} me={maya} opened={opened} onSaved={vi.fn()} onFailed={vi.fn()} />
      </RoomFramesContext>,
    );
    await waitFor(() => expect(document.querySelector(".ProseMirror")).not.toBeNull());
    const editor = document.querySelector<HTMLElement & { editor: Editor }>(".ProseMirror")!.editor;
    await waitFor(() => expect(fake.writing.get(socket)).toBe("t1"));
    socket.open = false;
    typeAtEnd(editor, "WRITTEN OFFLINE");
    // Closed, as on going to Messages, while the socket is away: this browser keeps it meanwhile.
    unmount();
    expect(localStorage.getItem("ember:canvas-unsaved:t1")).toContain("WRITTEN OFFLINE");
    socket.reconnect();
    // Confirmed, the canvas is let go, which the room saves as nobody else is writing it.
    await waitFor(() => expect(fake.saved.body).toContain("WRITTEN OFFLINE"), { timeout: 3000 });
    await waitFor(() => expect(localStorage.getItem("ember:canvas-unsaved:t1")).toBeNull());
    expect(fake.writing.has(socket)).toBe(false);
  });

  it("keeps each person's keys together, in order, as two people type at the same spot (D6)", async () => {
    const { sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    for (const socket of sockets) socket.latency = 120;
    typeAtEnd(mayas!, "Bravo");
    await waitFor(() => expect(sams!.getText()).toContain("Bravo"));
    for (const editor of [mayas!, sams!]) act(() => void editor.commands.setTextSelection(editor.state.doc.content.size - 1));
    // A key each 100 ms, with steps crossing on the way to the room and back.
    for (let key = 0; key < 12; key++) {
      act(() => void mayas!.commands.insertContent("m"));
      act(() => void sams!.commands.insertContent("s"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await waitFor(() => expect(mayas!.getText()).toBe(sams!.getText()), { timeout: 10_000 });
    // Every key is kept, each person's in one run, however their steps crossed on the way.
    const typed = mayas!.getText().slice(mayas!.getText().indexOf("Bravo") + "Bravo".length);
    expect(typed).toMatch(/^(m{12}s{12}|s{12}m{12})$/);
  });

  it("leaves out a paste too big to send, saying so, rather than have the room close the socket over it again and again", async () => {
    const { sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    // About 1.2 MB, past the most the room reads in a frame.
    typeAtEnd(mayas!, "x".repeat(1_200_000));
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(sockets[0].closedTooBig).toBe(0);
    expect(mayas!.getText()).not.toContain("xxxx");
    expect(screen.getAllByRole("status").map((status) => status.textContent)).toContain("That was too long to add to the canvas.");
    // Writing goes on as before.
    typeAtEnd(mayas!, "AFTER");
    await waitFor(() => expect(sams!.getText()).toContain("AFTER"));
    expect(sockets[0].closedTooBig).toBe(0);
  });

  it("sends steps that wait for the socket in frames the room reads, however much they add up to", async () => {
    const { sockets, editors } = writeTogether();
    await waitFor(() => expect(editors()).toHaveLength(2));
    const [mayas, sams] = editors();
    sockets[0].open = false;
    // Pasted and taken out again, a dozen times: each step fits a frame, all of them together don't.
    for (let paste = 0; paste < 12; paste++) {
      const before = mayas!.state.doc.content.size;
      typeAtEnd(mayas!, String(paste % 10).repeat(90_000));
      act(() => void mayas!.commands.deleteRange({ from: before, to: mayas!.state.doc.content.size }));
    }
    typeAtEnd(mayas!, "SENT");
    sockets[0].reconnect();
    await waitFor(() => expect(sams!.getText()).toContain("SENT"), { timeout: 10_000 });
    expect(sams!.getText()).toBe(mayas!.getText());
    expect(sockets[0].closedTooBig).toBe(0);
  });

  it("keeps each run whole when someone else's key lands where keys here wait for the room (D6)", () => {
    const schema = getSchema(canvasExtensions());
    const start = schema.nodeFromJSON({ type: "doc", content: [paragraph("Bravo")] });
    // Each at the end of "Bravo", which ends at 6.
    const writer = (clientID: string) => EditorState.create({ doc: start, plugins: [collab({ clientID })], selection: TextSelection.create(start, 6) });
    const typed = (state: EditorState, text: string) => state.apply(state.tr.insertText(text));
    const pending = (state: EditorState) => sendableSteps(state)!.steps;
    let [maya, sam] = [writer("maya"), writer("sam")];

    // Maya's first key reaches the room first; Sam's, typed meanwhile, goes in beside it.
    maya = typed(maya, "m");
    const first = pending(maya);
    maya = maya.apply(fromRoom(maya, first, ["maya"]));
    sam = typed(sam, "s");
    sam = sam.apply(fromRoom(sam, first, ["maya"]));
    const sams = pending(sam);
    // Maya types again before Sam's key reaches her, and again after.
    maya = typed(maya, "m");
    maya = maya.apply(fromRoom(maya, sams, ["sam"]));
    const second = pending(maya);
    maya = typed(maya, "m");
    expect(maya.doc.textContent).toBe("Bravosmmm");
    sam = sam.apply(fromRoom(sam, sams, ["sam"]));
    sam = sam.apply(fromRoom(sam, second, ["maya"]));
    expect(sam.doc.textContent).toBe("Bravosmm");
  });

  it("deletes only what was there as someone else writes at its edge", () => {
    const schema = getSchema(canvasExtensions());
    const start = schema.nodeFromJSON({ type: "doc", content: [paragraph("Bravo")] });
    let maya = EditorState.create({ doc: start, plugins: [collab({ clientID: "maya" })] });
    let sam = EditorState.create({ doc: start, plugins: [collab({ clientID: "sam" })] });
    // Sam writes where the "vo" Maya deletes begins, and reaches the room first.
    sam = sam.apply(sam.tr.insertText("s", 4));
    maya = maya.apply(maya.tr.delete(4, 6));
    maya = maya.apply(fromRoom(maya, sendableSteps(sam)!.steps, ["sam"]));
    expect(maya.doc.textContent).toBe("Bras");
  });

  it("applies steps in the editor's schema on the room, configured as the editor configures it", () => {
    const room = getSchema(canvasExtensions());
    const editor = getSchema([StarterKit.configure({ link: { openOnClick: false, autolink: true } })]);
    const specOf = (schema: typeof room) => ({ nodes: Object.keys(schema.nodes), marks: Object.keys(schema.marks), content: Object.values(schema.nodes).map((node) => node.spec.content ?? "") });
    expect(specOf(room)).toEqual(specOf(editor));
  });
});
