import type { RoomId, SharedRoom } from "@ember/protocol";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RoomOrder } from "./room-order";

const room = (id: string, name: string, parent?: string, kind: SharedRoom["kind"] = "open"): SharedRoom => ({
  id,
  kind,
  name,
  icon: null,
  ...(parent && { parent: { id: parent, name: "Strata" } }),
});
const rooms = [room("general", "general"), room("strata", "Strata", undefined, "closed"), room("sales", "Sales", "strata"), room("titling", "Titling", "strata"), room("inventory", "Inventory", "strata")];

function renderOrder(sharedOrder: RoomId[] = ["strata", "sales", "titling", "inventory", "general"]) {
  const saved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: unknown, init?: RequestInit) => Response.json({ sharedOrder: (JSON.parse(String(init?.body)) as { roomIds: RoomId[] }).roomIds })),
  );
  render(<RoomOrder rooms={rooms} sharedOrder={sharedOrder} onSaved={saved} onSessionChanged={vi.fn()} />);
  return saved;
}

const list = () => screen.getByRole("list", { name: "Room order" });
const topRooms = () => within(list()).getAllByRole("listitem").filter((item) => item.parentElement === list()).map((item) => item.dataset.roomId);
const subList = () => screen.getByRole("list", { name: "Strata’s sub-rooms" });
const subRoomsShown = () => within(subList()).getAllByRole("listitem").map((item) => item.dataset.roomId);

describe("Sub-rooms in the room order", () => {
  it("nests a parent's sub-rooms under it, behind an arrow, with New sub-room on each room of its own", async () => {
    renderOrder();
    expect(topRooms()).toEqual(["strata", "general"]);
    expect(screen.queryByRole("list", { name: "Strata’s sub-rooms" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New sub-room in Strata" })).toHaveAttribute("href", "/rooms/opens/new?parent=strata");
    expect(screen.getByRole("link", { name: "New sub-room in general" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show Strata’s 3 sub-rooms" }));
    expect(subRoomsShown()).toEqual(["sales", "titling", "inventory"]);
    expect(screen.getByRole("button", { name: "Hide Strata’s 3 sub-rooms" })).toHaveAttribute("aria-expanded", "true");
  });

  it("moves a sub-room among its parent's others, and a parent with its sub-rooms, saving each parent's after it", async () => {
    const saved = renderOrder();
    await userEvent.click(screen.getByRole("button", { name: /^Show Strata/ }));
    const inventory = within(subList()).getAllByRole("listitem")[2]!;
    fireEvent.keyDown(inventory, { key: "ArrowUp", altKey: true });
    expect(subRoomsShown()).toEqual(["sales", "inventory", "titling"]);
    // The first sub-room can't leave its parent.
    fireEvent.keyDown(within(subList()).getAllByRole("listitem")[0]!, { key: "ArrowUp", altKey: true });
    expect(subRoomsShown()).toEqual(["sales", "inventory", "titling"]);

    const general = within(list()).getAllByRole("listitem").find((item) => item.dataset.roomId === "general")!;
    fireEvent.keyDown(general, { key: "ArrowUp", altKey: true });
    expect(topRooms()).toEqual(["general", "strata"]);
    await userEvent.click(screen.getByRole("button", { name: "Save order" }));
    expect(saved).toHaveBeenCalledWith(["general", "strata", "sales", "inventory", "titling"]);
  });
});
