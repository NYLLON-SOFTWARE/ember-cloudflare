import { type Message, type ServerFrame, type User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePins } from "@/hooks/use-pins";
import type { RoomFrames } from "@/hooks/use-room";
import { PinnedPanel } from "./pinned-panel";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };

/** A message, whose body is its plain text as typed. */
const message = (id: string, plainText: string, overrides: Partial<Message> = {}): Message => ({
  id,
  clientMessageId: id,
  roomId: "general",
  creator: ada,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-11-13T10:00:00.000Z",
  updatedAt: "2026-11-13T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...overrides,
});

const general = { id: "general", name: "general", kind: "open", icon: null } as const;
const first = message("m1", "First pinned");
const second = message("m2", "Second pinned");

/** The panel, with the room's pins oldest first and their messages as the room has listed them. */
function show(pins: Parameters<typeof PinnedPanel>[0]["pins"], messages: Message[] = [], changes: Partial<Parameters<typeof PinnedPanel>[0]> = {}) {
  const onUnpin = vi.fn();
  const refresh = vi.fn();
  const onClose = vi.fn();
  const drawn = (pins: Parameters<typeof PinnedPanel>[0]["pins"], messages: Message[]) => (
    <PinnedPanel
      room={general}
      name="general"
      me={{ ...ada, administrator: false }}
      pins={pins}
      messages={new Map(messages.map((m) => [m.id, m]))}
      onUnpin={onUnpin}
      refresh={refresh}
      roomNotice={null}
      onDismissRoomNotice={vi.fn()}
      onClose={onClose}
      {...changes}
    />
  );
  const view = render(drawn(pins, messages));
  return {
    onUnpin,
    refresh,
    onClose,
    panel: screen.getByRole("complementary", { name: "Pinned messages" }),
    /** The panel again, its pins and listed messages as they've since become. */
    redraw: (pins: Parameters<typeof PinnedPanel>[0]["pins"], messages: Message[] = []) => view.rerender(drawn(pins, messages)),
  };
}

afterEach(cleanup);

/**
 * The panel over the pins of `frames`' room, which the pins hook keeps: what a test has the room say
 * comes through `usePins` to the panel, as it does through the workspace.
 */
function Pinned({ frames }: { frames: RoomFrames }) {
  const { pins, listed, refresh } = usePins("general", frames);
  return (
    <PinnedPanel
      room={general}
      name="general"
      me={{ ...ada, administrator: false }}
      pins={pins}
      messages={new Map(listed)}
      onUnpin={vi.fn()}
      refresh={refresh}
      roomNotice={null}
      onDismissRoomNotice={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

/** The room's socket, as the pins hook hears it, and what a test has the room say over it. */
function roomFrames() {
  const listeners = new Set<(frame: ServerFrame) => void>();
  return {
    frames: {
      send: () => true,
      listen: (listener: (frame: ServerFrame) => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    } satisfies RoomFrames,
    hear: (frame: ServerFrame) => act(() => listeners.forEach((listener) => listener(frame))),
  };
}

describe("The Pinned panel", () => {
  it("lists the room's pins in pin order, each with its message, who pinned it and when", () => {
    const { panel } = show(
      [
        { messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" },
        { messageId: "m2", by: ada, at: "2026-11-13T10:02:00.000Z" },
      ],
      [second, first],
    );
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("First pinned")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Pinned by Grace");
    // The pin's own time, beside the message's.
    expect(within(items[0]!).getAllByRole("time").map((time) => time.getAttribute("datetime"))).toContain("2026-11-13T10:01:00.000Z");
    expect(within(items[1]!).getByText("Second pinned")).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("Pinned by Ada");
  });

  it("links each pin's Jump to its message in the room, and unpins from it", async () => {
    const { onUnpin, panel } = show([{ messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" }], [first]);
    const user = userEvent.setup();
    const item = within(panel).getByRole("listitem");
    expect(within(item).getByRole("link", { name: "Jump" })).toHaveAttribute("href", "/rooms/general/@m1");

    await user.click(within(item).getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith("m1");
  });

  it("asks for the room's pins while one's time waits for its listing, and once they've all come it doesn't", () => {
    const waiting = show([{ messageId: "m1", by: grace, at: null }], [first]);
    expect(waiting.refresh).toHaveBeenCalledOnce();

    cleanup();
    const listed = show([{ messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" }], [first]);
    expect(listed.refresh).not.toHaveBeenCalled();
  });

  it("asks again when which pins wait for their listing changes, as a listing and another pin's arrival come together", () => {
    // A pin's in whose time waits, so the room's been asked.
    const waiting = show([{ messageId: "m1", by: grace, at: null }], [first]);
    expect(waiting.refresh).toHaveBeenCalledOnce();

    // Its listing and another pin's arrival are taken in together: m1's time has come, m2's now waits.
    waiting.redraw(
      [
        { messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" },
        { messageId: "m2", by: ada, at: null },
      ],
      [first],
    );
    expect(waiting.refresh).toHaveBeenCalledTimes(2);

    // The listing answers with both pins and their messages, which the panel shows, asking no more.
    waiting.redraw(
      [
        { messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" },
        { messageId: "m2", by: ada, at: "2026-11-13T10:02:00.000Z" },
      ],
      [first, second],
    );
    const panel = screen.getByRole("complementary", { name: "Pinned messages" });
    const items = within(panel).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[1]!).getByText("Second pinned")).toBeInTheDocument();
    expect(waiting.refresh).toHaveBeenCalledTimes(2);
  });

  it("says when nothing's pinned, and offers no Unpin where nothing can change, as in a room that's gone", () => {
    show([]);
    expect(screen.getByText("Nothing pinned yet.")).toBeInTheDocument();
    cleanup();

    show([{ messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" }], [first], { onUnpin: null });
    expect(screen.getByRole("link", { name: "Jump" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unpin" })).not.toBeInTheDocument();
  });

  it("names a DM's panel for its room, and closes", async () => {
    const { onClose } = show([{ messageId: "m1", by: grace, at: "2026-11-13T10:01:00.000Z" }], [first], {
      room: { id: "direct-1", kind: "direct", members: [ada, grace], activeAt: "2026-11-13T10:00:00.000Z" },
      name: "Grace",
    });
    const user = userEvent.setup();
    expect(screen.getByRole("complementary", { name: "Pinned messages" })).toHaveTextContent("Grace");
    await user.click(screen.getByRole("button", { name: "Close pinned messages" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retells a pinned reply as its parent's edit or keeping for its replies comes, as its room's timeline does", () => {
    const { frames, hear } = roomFrames();
    render(<Pinned frames={frames} />);

    // The room lists a reply also sent to it, pinned, whose parent's start it shows.
    hear({
      type: "pins.listed",
      pins: [{ message: message("r1", "A reply", { parentId: "p1", alsoSent: true, parentText: "The parent's first words" }), by: grace, at: "2026-11-13T10:01:00.000Z" }],
    });
    expect(screen.getByRole("link", { name: "The parent's first words" })).toBeInTheDocument();

    // The parent's edit retells the reply the room also sent there, which the panel shows as the timeline does.
    hear({ type: "message.updated", message: message("p1", "The parent's retold words", { editedAt: "2026-11-13T11:00:00.000Z" }), seq: 2 });
    expect(screen.getByRole("link", { name: "The parent's retold words" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "The parent's first words" })).not.toBeInTheDocument();

    // Deleted with its thread's replies left, the parent is kept for them without its text, which the reply then says.
    hear({ type: "message.updated", message: message("p1", "", { deleted: true }), seq: 3 });
    expect(screen.getByRole("link", { name: "This message was deleted." })).toBeInTheDocument();
  });
});
