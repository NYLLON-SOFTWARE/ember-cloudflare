import type { Me, Room } from "@ember/protocol";
import type { Library, OpenedTab, RoomTab } from "@ember/protocol/library";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate } from "@/hooks/use-route";
import { RoomTabs, useRoomTabs } from "./room-tabs";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };

const tab = (id: string, kind: RoomTab["kind"], title: string, extra: Partial<RoomTab> = {}): RoomTab => ({
  id,
  roomId: "general",
  kind,
  title,
  creator: ada,
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-01T10:00:00.000Z",
  ...extra,
});

const tabs = [tab("t1", "folder", "Plans"), tab("t2", "link", "Guide", { url: "https://example.com/guide" })];

const library: Library = {
  files: [
    {
      id: "k1",
      kind: "file",
      name: "Budget.csv",
      type: "spreadsheets",
      roomId: "general",
      owner: ada,
      createdAt: "2026-11-10T10:00:00.000Z",
      messageId: "m1",
      file: { id: "k1", name: "Budget.csv", contentType: "text/csv", byteSize: 10, url: "/files/k1/s/Budget.csv", downloadUrl: "/files/k1/s/Budget.csv?disposition=attachment" },
      starred: false,
      viewedAt: null,
    },
  ],
  links: [{ id: "m2:0", url: "https://example.org/maps", title: "Maps", roomId: "general", messageId: "m2", owner: ada, createdAt: "2026-11-09T10:00:00.000Z" }],
};

/** Answers the strip's requests: its tabs, Files & links, a folder, and adding one. */
function serve() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const path = String(url);
    if (path === "/api/rooms/general/tabs" && init?.method === "POST") {
      const sent = JSON.parse(String(init.body)) as { title: string };
      return Response.json({ tab: tab("t3", "folder", sent.title), items: [] } satisfies OpenedTab);
    }
    if (path === "/api/rooms/general/tabs") return Response.json({ tabs });
    if (path === "/api/rooms/general/library") return Response.json(library);
    if (path.startsWith("/api/rooms/general/tabs/")) return Response.json({ tab: tabs[0]!, items: [] } satisfies OpenedTab);
    return Response.json({}, { status: 404 });
  });
}

const failed = vi.fn();

/** The strip, with the tabs a room's view keeps for it. */
function Strip({ deleted }: { deleted: boolean }) {
  const state = useRoomTabs(general, deleted, failed);
  return <RoomTabs room={general} me={ada} state={state} onFailed={failed} />;
}

/** The strip over a room's messages, as the room's main content holds it. */
function renderStrip(deleted = false) {
  return render(
    <main className="relative">
      <Strip deleted={deleted} />
      <section aria-label="Messages">Timeline</section>
    </main>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  navigate("/");
});

describe("Room tabs", () => {
  it("shows Messages, Files & links and the room's own tabs, a link opening in a new tab", async () => {
    serve();
    renderStrip();
    const strip = screen.getByRole("tablist", { name: "Room tabs" });
    expect(within(strip).getByRole("tab", { name: "Messages" })).toHaveAttribute("aria-selected", "true");
    expect(await within(strip).findByRole("tab", { name: "Plans" })).toHaveAttribute("aria-selected", "false");
    const guide = within(strip).getByRole("link", { name: "Guide" });
    expect(guide).toHaveAttribute("href", "https://example.com/guide");
    expect(guide).toHaveAttribute("target", "_blank");
  });

  it("covers the messages with Files & links, which lists the room's files and links", async () => {
    serve();
    renderStrip();
    await userEvent.click(screen.getByRole("tab", { name: "Files & links" }));
    const panel = await screen.findByRole("tabpanel", { name: "Files & links" });
    // The panels load with the pages few visits need, which take a while the first time.
    expect(await within(panel).findByRole("link", { name: "Budget.csv" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Maps" })).toHaveAttribute("href", "https://example.org/maps");
    expect(screen.getByRole("region", { name: "Messages", hidden: true })).toHaveProperty("inert", true);

    await userEvent.click(within(panel).getByRole("button", { name: "Links" }));
    await waitFor(() => expect(within(panel).queryByRole("link", { name: "Budget.csv" })).not.toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Messages" })).toHaveProperty("inert", false);
  });

  it("adds a folder from the + menu and opens it", async () => {
    serve();
    renderStrip();
    await screen.findByRole("tab", { name: "Plans" });
    await userEvent.click(screen.getByRole("button", { name: "Add a tab" }));
    await userEvent.click(screen.getByRole("button", { name: "Folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a folder" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Name" }), "Roadmap");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "true");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/rooms/general/tabs", expect.objectContaining({ method: "POST", body: JSON.stringify({ kind: "folder", title: "Roadmap" }) }));
  });

  it("gives each tab an address, which Back and Forward go between", async () => {
    serve();
    navigate("/rooms/general");
    renderStrip();
    await userEvent.click(await screen.findByRole("tab", { name: "Plans" }));
    expect(location.pathname + location.search).toBe("/rooms/general?tab=t1");
    await userEvent.click(screen.getByRole("tab", { name: "Files & links" }));
    expect(location.search).toBe("?tab=files");
    await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(location.pathname + location.search).toBe("/rooms/general");

    history.back();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Files & links" })).toHaveAttribute("aria-selected", "true"));
    history.back();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Plans" })).toHaveAttribute("aria-selected", "true"));
    history.forward();
    await waitFor(() => expect(screen.getByRole("tab", { name: "Files & links" })).toHaveAttribute("aria-selected", "true"));
  });

  it("opens the tab its address names", async () => {
    serve();
    navigate("/rooms/general?tab=files");
    renderStrip();
    expect(screen.getByRole("tab", { name: "Files & links" })).toHaveAttribute("aria-selected", "true");
  });

  it("leaves a room that's gone its messages alone, with no tabs to open or add, asking for none", () => {
    serve();
    navigate("/rooms/general?tab=files");
    renderStrip(true);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Messages"]);
    expect(screen.getByRole("tab", { name: "Messages" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("tabpanel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a tab" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Messages" })).toHaveProperty("inert", false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps + in reach however many tabs there are, outside the tabs that scroll", async () => {
    serve();
    renderStrip();
    await screen.findByRole("tab", { name: "Plans" });
    expect(screen.getByRole("tablist", { name: "Room tabs" })).not.toContainElement(screen.getByRole("button", { name: "Add a tab" }));
  });
});
