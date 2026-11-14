import type { DirectoryUser, Me, Message, Room, SavedItem, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { SavedPanel } from "./saved-panel";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const grace: User = { id: "u2", name: "Grace Hopper" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };
const dm: Room = { id: "direct-1", kind: "direct", members: [{ id: ada.id, name: ada.name }, grace], activeAt: "2026-10-15T12:00:00.000Z" };
/** The people directory, listing Grace. */
const withGrace: People = new Map([[grace.id, { ...grace, bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" } satisfies DirectoryUser]]);

/** The message `id`, which `creator` wrote in `room`. */
const message = (id: string, room: Room, plainText: string, creator: User = grace): Message => ({
  id,
  clientMessageId: `c-${id}`,
  roomId: room.id,
  creator,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
});

/** The save of `message`, saved at `savedAt`, in milliseconds since the epoch. */
const savedAt = (id: string, message: Message, savedAt: number): SavedItem => ({ id: `save-${id}`, roomId: message.roomId, messageId: message.id, createdAt: savedAt, message });

/** The pane, listing `saves`, with `rooms` naming the rooms they live in. */
function renderPane(saves: SavedItem[] | null, rooms: Room[] = [general, dm], onForget = vi.fn(), onClose = vi.fn()) {
  return render(
    <PeopleContext value={withGrace}>
      <SavedPanel me={ada} rooms={rooms} saves={saves} onForget={onForget} onClose={onClose} />
    </PeopleContext>,
  );
}

describe("Saved pane", () => {
  /** The card's header, which names the room the save lives in and the day it was saved. */
  const header = (card: HTMLElement) => card.firstElementChild!.firstElementChild!;

  it("lists your saves, newest save first, each naming the room it lives in and the day it was saved", () => {
    renderPane([
      savedAt("second", message("m2", general, "Saved second"), Date.UTC(2026, 9, 14)),
      savedAt("first", message("m1", dm, "Saved first"), Date.UTC(2026, 9, 13)),
    ]);
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(header(cards[0]!)).toHaveTextContent("general");
    expect(within(cards[0]!).getByText("Saved second")).toBeInTheDocument();
    expect(within(header(cards[0]!)).getByText(/October 14/)).toBeInTheDocument();
    // A DM is named for the other person in it, as its room is.
    expect(within(header(cards[1]!)).getByText("Grace Hopper")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("Saved first")).toBeInTheDocument();
    expect(within(header(cards[1]!)).getByRole("link", { name: "Jump" })).toHaveAttribute("href", "/rooms/direct-1/@m1");
  });

  it("removes a save, and closes", async () => {
    const onForget = vi.fn();
    const onClose = vi.fn();
    renderPane([savedAt("only", message("m1", general, "Only this"), Date.UTC(2026, 9, 14))], [general], onForget, onClose);
    await userEvent.click(screen.getByRole("button", { name: "Remove from saved" }));
    expect(onForget).toHaveBeenCalledWith("save-only");
    await userEvent.click(screen.getByRole("button", { name: "Close saved messages" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("says a room you've left for a save whose room isn't yours any more, whose message still shows", () => {
    renderPane([savedAt("only", message("m1", { id: "gone", name: "gone", kind: "open", icon: null }, "Gone but saved"), 0) /* the room's name isn't among yours */], [general]);
    expect(screen.getByText("A room you've left")).toBeInTheDocument();
    expect(screen.getByText("Gone but saved")).toBeInTheDocument();
  });

  it("says there's nothing saved yet, and that it's loading before the list comes", () => {
    const { rerender } = renderPane(null);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    rerender(
      <PeopleContext value={withGrace}>
        <SavedPanel me={ada} rooms={[general]} saves={[]} onForget={vi.fn()} onClose={vi.fn()} />
      </PeopleContext>,
    );
    expect(screen.getByText("Nothing saved yet")).toBeInTheDocument();
    expect(screen.getByText("Save a message from its More actions to find it here.")).toBeInTheDocument();
  });
});
