import type { ClientFrame, Me, Room, ServerFrame, User } from "@ember/protocol";
import { EMPTY_CANVAS, type Canvas, type OpenedTab } from "@ember/protocol/library";
import type { Editor } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomFrames } from "@/hooks/use-room";
import { canvasExtensions } from "../../../../worker/src/canvas-schema";
import { CanvasSessions } from "../../../../worker/src/canvas-sessions";
import { CanvasEditor } from "./canvas-editor";
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
  constructor(
    readonly room: FakeRoom,
    readonly user: User,
  ) {}
  deliver(frame: ServerFrame) {
    if (this.open) queueMicrotask(() => act(() => this.listeners.forEach((listener) => listener(frame))));
  }
  readonly frames: RoomFrames = {
    send: (frame: ClientFrame) => {
      if (!this.open) return false;
      void this.room.handle(this, frame);
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

  it("applies steps in the editor's schema on the room, configured as the editor configures it", () => {
    const room = getSchema(canvasExtensions());
    const editor = getSchema([StarterKit.configure({ link: { openOnClick: false, autolink: true } })]);
    const specOf = (schema: typeof room) => ({ nodes: Object.keys(schema.nodes), marks: Object.keys(schema.marks), content: Object.values(schema.nodes).map((node) => node.spec.content ?? "") });
    expect(specOf(room)).toEqual(specOf(editor));
  });
});
