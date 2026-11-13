import type { Me, Message, Room, SavedItem, User } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { SavedPage, TodosPage } from "./kept-pages";

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const grace: User = { id: "u2", name: "Grace" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };

const message = (id: string, plainText: string, parentId?: string): Message => ({
  id,
  clientMessageId: id,
  roomId: general.id,
  creator: grace,
  body: bodyFromPlainText(plainText),
  plainText,
  mentions: [],
  createdAt: "2026-10-12T10:00:00.000Z",
  updatedAt: "2026-10-12T10:00:00.000Z",
  editedAt: null,
  boosts: [],
  ...(parentId && { parentId }),
});

const item = (id: string, changes: Partial<SavedItem>): SavedItem => ({
  id,
  list: "todo",
  kind: "message",
  roomId: general.id,
  messageId: `m-${id}`,
  completedAt: null,
  remindAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...changes,
});

/** Shows a list's page, answering its list with `items` and any change with the item it's made of. */
function showPage(Page: typeof TodosPage, items: SavedItem[], itemId?: string, elsewhere: SavedItem[] = []) {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const path = String(input);
    if (init?.method === "PATCH") {
      const changed = items.find(({ id }) => path.endsWith(id))!;
      const change = JSON.parse(String(init.body)) as { completed?: boolean; list?: string };
      return Response.json({ ...changed, ...(change.completed !== undefined && { completedAt: change.completed ? "2026-11-12T00:00:00.000Z" : null }), ...(change.list && { list: change.list }) });
    }
    if (init?.method === "DELETE") return Response.json({ error: "That item isn't in your lists" }, { status: 404 });
    if (init?.method === "POST") return Response.json({ ...items[0], id: "again" }, { status: 201 });
    const one = elsewhere.find(({ id }) => path === `/api/saved/${id}`);
    if (one) return Response.json(one);
    return Response.json({ items });
  });
  const failed = vi.fn();
  render(
    <Sheet>
      <Page me={ada} rooms={[general]} itemId={itemId} onFailed={failed} />
    </Sheet>,
  );
  return Object.assign(fetch, { failed });
}

describe("To-dos", () => {
  it("lists to-dos in progress and completed, each with who wrote its message, where, and when, across the page until one opens", async () => {
    showPage(TodosPage, [item("a", { message: message("m-a", "Ship the deck") }), item("b", { message: message("m-b", "Reply to Lin", "p1"), completedAt: "2026-11-02T00:00:00.000Z" }), item("c", { kind: "note", roomId: undefined, messageId: undefined, body: "<p>Call Grace</p>", plainText: "Call Grace", files: [] })]);
    const inProgress = await screen.findByRole("button", { name: /^In progress\s*\d/ });
    expect(inProgress).toHaveTextContent("In progress2");
    expect(screen.getByRole("button", { name: /^Completed\s*\d/ })).toHaveTextContent("Completed1");
    expect(screen.getByText("Ship the deck")).toBeInTheDocument();
    expect(screen.getByText(/^\S.* · #general ·$/)).toBeInTheDocument();
    expect(screen.getByText(/Thread in #general/)).toBeInTheDocument();
    expect(screen.getByText("Call Grace")).toBeInTheDocument();
    expect(screen.getByText(/Reply to Lin/)).toHaveClass("line-through");
    expect(screen.getByRole("main", { name: "To-dos" })).toBeInTheDocument();
  });

  it("marks a to-do completed from its row, moving it to Completed", async () => {
    const fetch = showPage(TodosPage, [item("a", { message: message("m-a", "Ship the deck") })]);
    const row = (await screen.findByText("Ship the deck")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Mark completed" }));
    expect(fetch).toHaveBeenCalledWith("/api/saved/a", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ completed: true }) }));
    expect(await screen.findByRole("button", { name: /^Completed\s*\d/ })).toHaveTextContent("Completed1");
  });

  it("moves a to-do of your own to Saved, as any to-do", async () => {
    const fetch = showPage(TodosPage, [item("n", { kind: "note", roomId: undefined, messageId: undefined, body: "<p>Call Grace</p>", plainText: "Call Grace", files: [] })]);
    const row = (await screen.findByText("Call Grace")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Move to Saved" }));
    expect(fetch).toHaveBeenCalledWith("/api/saved/n", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ list: "saved" }) }));
  });

  it("says an overdue to-do is overdue first, in place of its date, and a note of your own shows no face", async () => {
    showPage(TodosPage, [item("a", { message: message("m-a", "Ship the deck"), remindAt: "2026-11-02T09:00:00.000Z", reminded: true }), item("n", { kind: "note", roomId: undefined, messageId: undefined, body: "<p>Call Grace</p>", plainText: "Call Grace", files: [] })]);
    const row = (await screen.findByText("Ship the deck")).closest("li")!;
    expect(within(row).getByText("Overdue")).toHaveClass("text-negative");
    expect(within(row).getByText("Overdue").parentElement).toHaveTextContent(/^Overdue · Grace · #general$/);
    expect(within(row).queryByRole("time")).not.toBeInTheDocument();
    expect(within(screen.getByText("Call Grace").closest("li")!).queryByRole("img")).not.toBeInTheDocument();
  });

  it("says only Overdue under an overdue note of your own, with no separator after it", async () => {
    showPage(TodosPage, [item("n", { kind: "note", roomId: undefined, messageId: undefined, body: "<p>Call Grace</p>", plainText: "Call Grace", files: [], remindAt: "2026-11-02T09:00:00.000Z", reminded: true })]);
    const row = (await screen.findByText("Call Grace")).closest("li")!;
    expect(within(row).getByText("Overdue").parentElement).toHaveTextContent(/^Overdue$/);
  });

  it("filters by the chips over the list", async () => {
    showPage(TodosPage, [item("a", { message: message("m-a", "Ship the deck") }), item("n", { kind: "note", roomId: undefined, messageId: undefined, body: "<p>Call Grace</p>", plainText: "Call Grace", files: [] })]);
    await screen.findByText("Ship the deck");
    const chips = within(screen.getByRole("group", { name: "Filter" }));
    expect(chips.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(chips.getByRole("button", { name: "Your own" }));
    expect(screen.queryByText("Ship the deck")).not.toBeInTheDocument();
    expect(screen.getByText("Call Grace")).toBeInTheDocument();
  });

  it("says a deleted message was deleted, and a message out of sight is unavailable", async () => {
    showPage(TodosPage, [item("a", { message: null }), item("b", { unavailable: true })]);
    expect(await screen.findByText("This message was deleted")).toBeInTheDocument();
    expect(screen.getByText("This message is unavailable")).toBeInTheDocument();
  });
});

describe("Saved", () => {
  it("offers only Move to To-dos and Remove from saved on a row, and moves one out of Saved", async () => {
    showPage(SavedPage, [item("a", { list: "saved", message: message("m-a", "Good read") })]);
    const row = (await screen.findByText("Good read")).closest("li")!;
    const bar = within(row);
    expect(bar.queryByRole("button", { name: "Mark completed" })).not.toBeInTheDocument();
    expect(bar.queryByRole("button", { name: "Add reminder" })).not.toBeInTheDocument();
    expect(bar.getByRole("button", { name: "Remove from saved" })).toBeInTheDocument();
    await userEvent.click(bar.getByRole("button", { name: "Move to To-dos" }));
    expect(await screen.findByText("Nothing saved")).toBeInTheDocument();
  });
});

describe("Remove from saved", () => {
  it("offers Undo for a moment, which saves the message again", async () => {
    const fetch = showPage(SavedPage, [item("a", { list: "saved", message: message("m-a", "Good read") })]);
    const row = (await screen.findByText("Good read")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Remove from saved" }));
    expect(screen.getByRole("status")).toHaveTextContent("Removed from saved");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(fetch).toHaveBeenCalledWith("/api/saved", expect.objectContaining({ method: "POST", body: JSON.stringify({ list: "saved", roomId: "general", messageId: "m-a" }) }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("Either list", () => {
  it("goes on to an item's own list from the other's address", async () => {
    history.replaceState(null, "", "/todos/s1");
    showPage(TodosPage, [], "s1", [item("s1", { list: "saved", message: message("m-s1", "Moved") })]);
    await vi.waitFor(() => expect(location.pathname).toBe("/saved/s1"));
  });

  it("takes an item another tab cleared first as cleared, saying nothing", async () => {
    const fetch = showPage(SavedPage, [item("a", { list: "saved", message: message("m-a", "Gone twice") })]);
    const row = (await screen.findByText("Gone twice")).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Remove from saved" }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/saved/a", { method: "DELETE" }));
    expect(fetch.failed).not.toHaveBeenCalled();
  });
});
