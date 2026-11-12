import type { DirectoryUser, Me, Room } from "@ember/protocol";
import type { Library, LibraryFile } from "@ember/protocol/library";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "@/components/ui/sheet";
import { PeopleContext, type People } from "@/hooks/use-directory";
import { FilesNav } from "./files-nav";
import { FilesPage } from "./files-page";

const ada: Me = { id: "u1", name: "Ada Lovelace", administrator: false };
const grace = { id: "u2", name: "Grace Hopper" };
const general: Room = { id: "general", name: "general", kind: "open", icon: null };
const people: People = new Map([[grace.id, { ...grace, bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" } satisfies DirectoryUser]]);

const stored = (id: string, name: string, contentType: string) => ({
  id,
  name,
  contentType,
  byteSize: 2048,
  url: `/files/${id}/sig/${name}`,
  downloadUrl: `/files/${id}/sig/${name}?disposition=attachment`,
});

const files: LibraryFile[] = [
  {
    id: "k1",
    kind: "file",
    name: "Budget.csv",
    type: "spreadsheets",
    roomId: "general",
    owner: grace,
    createdAt: "2026-11-10T10:00:00.000Z",
    messageId: "m1",
    file: stored("k1", "Budget.csv", "text/csv"),
    starred: false,
    viewedAt: null,
  },
  {
    id: "k2",
    kind: "file",
    name: "Moon landing.jpg",
    type: "images",
    roomId: "general",
    owner: ada,
    createdAt: "2026-11-09T10:00:00.000Z",
    messageId: "m2",
    file: stored("k2", "Moon landing.jpg", "image/jpeg"),
    starred: true,
    viewedAt: null,
  },
  { id: "t1", kind: "canvas", name: "Launch notes", type: "documents", roomId: "general", owner: ada, createdAt: "2026-11-01T10:00:00.000Z", starred: false, viewedAt: null },
];

/** Answers the page's requests: the files, and marks as they're sent. */
function serve() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "/api/files") return Response.json({ files, links: [] } satisfies Library);
    const sent = JSON.parse(String(init?.body)) as { starred?: boolean };
    return Response.json({ starred: sent.starred ?? false, viewedAt: null });
  });
}

function renderPage(place: "all" | "canvases" | "starred" = "all") {
  return render(
    <PeopleContext value={people}>
      <Sheet>
        <FilesNav me={ada} place={place} />
        <FilesPage me={ada} place={place} rooms={[general]} onFailed={vi.fn()} />
      </Sheet>
    </PeopleContext>,
  );
}

/** The names of the files the page lists, in order. */
const rows = () =>
  within(screen.getByRole("list", { name: /All files|Canvases|Starred/ }))
    .getAllByRole("listitem")
    .map((row) => row.querySelector("a")!.textContent);

afterEach(() => vi.restoreAllMocks());

describe("Files page", () => {
  it("lists every file and canvas, with who shared it where, and narrows them by owner and search", async () => {
    serve();
    renderPage();
    expect(await screen.findByRole("heading", { name: "All files", level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(rows()).toEqual(["Budget.csv", "Moon landing.jpg", "Launch notes"]));
    expect(screen.getByRole("link", { name: "Budget.csv" })).toHaveAttribute("href", "/files/k1/sig/Budget.csv");
    expect(screen.getByRole("link", { name: "Launch notes" })).toHaveAttribute("href", "/rooms/general?tab=t1");
    expect(screen.getAllByText("Grace Hopper")[0]).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Created by you" }));
    expect(rows()).toEqual(["Moon landing.jpg", "Launch notes"]);
    await userEvent.click(screen.getByRole("button", { name: "Shared with you" }));
    expect(rows()).toEqual(["Budget.csv"]);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search files" }), "moon");
    expect(rows()).toEqual(["Moon landing.jpg"]);
  });

  it("lists only canvases on Canvases, and starred files on Starred and beside the page", async () => {
    serve();
    const { unmount } = renderPage("canvases");
    await waitFor(() => expect(rows()).toEqual(["Launch notes"]));
    unmount();
    renderPage("starred");
    await waitFor(() => expect(rows()).toEqual(["Moon landing.jpg"]));
    const nav = screen.getByRole("navigation", { name: "Files" });
    expect(within(nav).getByRole("link", { name: "Starred" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Moon landing.jpg" })).toBeInTheDocument();
  });

  it("stars a file at once, saving it, and lists it beside the page", async () => {
    serve();
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "Star Budget.csv" }));
    expect(screen.getByRole("button", { name: "Unstar Budget.csv" })).toHaveAttribute("aria-pressed", "true");
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/files/marks", expect.objectContaining({ method: "PUT", body: JSON.stringify({ fileId: "k1", roomId: "general", messageId: "m1", starred: true }) }));
    expect(within(screen.getByRole("navigation", { name: "Files" })).getByRole("link", { name: "Budget.csv" })).toBeInTheDocument();
  });

  it("narrows them to kinds of file from the Types menu", async () => {
    serve();
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "File types: all" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Images" }));
    await userEvent.keyboard("{Escape}");
    expect(rows()).toEqual(["Moon landing.jpg"]);
  });

  it("takes every filter off with Clear filters, Types and whose files included, leaving the search", async () => {
    serve();
    renderPage();
    await waitFor(() => expect(rows()).toHaveLength(3));
    await userEvent.click(screen.getByRole("button", { name: "File types: all" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Images" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Spreadsheets" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Shared with you" }));
    await userEvent.click(screen.getByRole("button", { name: "Filters" }));
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Date" }), "today");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.type(screen.getByRole("searchbox", { name: "Search files" }), "a");
    expect(screen.getByRole("button", { name: "Filters, 1 on" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Filters, 1 on" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File types: all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("searchbox", { name: "Search files" })).toHaveValue("a");
    expect(rows()).toEqual(["Moon landing.jpg", "Launch notes"]);
  });
});
