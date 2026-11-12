import type { Me, SharedRoom } from "@ember/protocol";
import type { ComponentProps } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import type { PendingMessage } from "@/lib/room-state";
import { keepUnsent, keptInRoom } from "@/lib/unsent-store";
import { RoomUnavailable } from "./room-unavailable";

/** The pane, in the drawer's sheet that its bar's button opens, as the workspace has it. */
const show = (props: ComponentProps<typeof RoomUnavailable>) => render(<RoomUnavailable {...props} />, { wrapper: Sheet });

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const leads: SharedRoom = { id: "leads", kind: "closed", name: "Leads", icon: null };
const general: SharedRoom = { id: "general", kind: "open", name: "general", icon: null };

/** A message Ada wrote in Leads that it never had. */
const unsent = (text: string): PendingMessage => ({
  id: text,
  clientMessageId: text,
  roomId: leads.id,
  creator: ada,
  body: `<p>${text}</p>`,
  plainText: text,
  mentions: [],
  createdAt: "2026-11-12T10:00:00.000Z",
  updatedAt: "2026-11-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  pending: true,
  queued: true,
});

afterEach(() => localStorage.clear());

describe("A room that's gone", () => {
  it("lists what you wrote there that it never had, each to copy or delete, which forgets it", async () => {
    keepUnsent(leads.id, ada.id, undefined, [unsent("First thought"), unsent("Second thought")]);
    show({ room: leads, gone: "lost access", goTo: general, me: ada });
    const list = await screen.findByRole("list", { name: "Not sent" });
    expect(within(list).getAllByRole("listitem").map((item) => item.querySelector("p")!.textContent)).toEqual(["First thought", "Second thought"]);
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(within(first).getByRole("button", { name: "Copy" })).toBeInTheDocument();

    await userEvent.click(within(first).getByRole("button", { name: "Delete" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(keptInRoom(leads.id, ada.id).map((m) => m.plainText)).toEqual(["Second thought"]);
  });

  it("lists nothing, and says nothing of it, where nothing was left unsent, nor for an address naming no room", () => {
    const { unmount } = show({ room: leads, gone: "deleted", goTo: general, me: ada });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/^#Leads was deleted$/);
    unmount();
    show({ room: null, gone: "lost access", goTo: general, me: ada });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // Nothing to name in the bar, so on a wide screen it has no rule under it.
    expect(screen.getByRole("navigation", { name: "Page" })).toHaveClass("md:border-b-0");
  });
});
