import { type Message, type User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PinnedPanel } from "./pinned-panel";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };

/** A message, whose body is its plain text as typed. */
const message = (id: string, plainText: string): Message => ({
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
});

const general = { id: "general", name: "general", kind: "open", icon: null } as const;
const first = message("m1", "First pinned");
const second = message("m2", "Second pinned");

/** The panel, with the room's pins oldest first and their messages as the room has listed them. */
function show(pins: Parameters<typeof PinnedPanel>[0]["pins"], messages: Message[] = [], changes: Partial<Parameters<typeof PinnedPanel>[0]> = {}) {
  const onUnpin = vi.fn();
  const refresh = vi.fn();
  const onClose = vi.fn();
  render(
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
    />,
  );
  return { onUnpin, refresh, onClose, panel: screen.getByRole("complementary", { name: "Pinned messages" }) };
}

afterEach(cleanup);

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
});
