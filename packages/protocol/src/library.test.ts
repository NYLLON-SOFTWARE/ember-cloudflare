import { describe, expect, it } from "vitest";
import {
  CANVAS_TOO_LONG,
  EMPTY_CANVAS,
  fileTypeOf,
  filtersOn,
  isWebAddress,
  isWithin,
  listFiles,
  listLinks,
  MAX_CANVAS_LENGTH,
  NO_FILE_FILTERS,
  parseCanvasSave,
  parseFileMark,
  parseNewFolderItem,
  parseNewTab,
  parseTabChange,
  parseTabOrder,
  type LibraryFile,
  type LibraryLink,
} from "./library.ts";
import { filesPath, workspacePageOf } from "./pages.ts";

const ada = { id: "ada", name: "Ada" };
const grace = { id: "grace", name: "Grace" };

const file = (name: string, overrides: Partial<LibraryFile> = {}): LibraryFile => ({
  id: name,
  kind: "file",
  name,
  type: fileTypeOf("", name),
  roomId: "general",
  owner: ada,
  createdAt: "2026-11-01T12:00:00.000Z",
  starred: false,
  viewedAt: null,
  ...overrides,
});

describe("fileTypeOf", () => {
  it("reads a file's kind from its type, or else its name", () => {
    expect(fileTypeOf("application/pdf", "x")).toBe("pdfs");
    expect(fileTypeOf("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "x")).toBe("spreadsheets");
    expect(fileTypeOf("application/vnd.ms-powerpoint", "x")).toBe("presentations");
    expect(fileTypeOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x")).toBe("documents");
    expect(fileTypeOf("image/png", "x")).toBe("images");
    expect(fileTypeOf("video/mp4", "x")).toBe("videos");
    expect(fileTypeOf("audio/mpeg", "x")).toBe("audio");
    expect(fileTypeOf("application/json", "x")).toBe("snippets");
    expect(fileTypeOf("application/octet-stream", "Budget.CSV")).toBe("spreadsheets");
    expect(fileTypeOf("application/octet-stream", "deck.key")).toBe("presentations");
    expect(fileTypeOf("application/octet-stream", "main.rs")).toBe("snippets");
    expect(fileTypeOf("application/zip", "archive.zip")).toBe("other");
    expect(fileTypeOf("", "README")).toBe("other");
  });
});

describe("listFiles", () => {
  const now = new Date("2026-11-11T15:00:00.000Z");
  const files = [
    file("Budget.csv", { owner: grace, createdAt: "2026-11-11T10:00:00.000Z", viewedAt: "2026-11-11T14:00:00.000Z" }),
    file("moon.png", { createdAt: "2026-11-05T10:00:00.000Z", starred: true, roomId: "random" }),
    file("Notes", { kind: "canvas", type: "documents", createdAt: "2026-10-01T10:00:00.000Z", viewedAt: "2026-11-10T10:00:00.000Z" }),
    file("agenda.pdf", { owner: grace, createdAt: "2026-09-01T10:00:00.000Z" }),
  ];
  const names = (filters = NO_FILE_FILTERS, sort: Parameters<typeof listFiles>[2] = "newest") => listFiles([...files], filters, sort, "ada", now).map(({ name }) => name);

  it("sorts by when they were last opened, those never opened newest first after them, or by date or name", () => {
    expect(names(NO_FILE_FILTERS, "viewed")).toEqual(["Budget.csv", "Notes", "moon.png", "agenda.pdf"]);
    expect(names(NO_FILE_FILTERS, "newest")).toEqual(["Budget.csv", "moon.png", "Notes", "agenda.pdf"]);
    expect(names(NO_FILE_FILTERS, "oldest")).toEqual(["agenda.pdf", "Notes", "moon.png", "Budget.csv"]);
    expect(names(NO_FILE_FILTERS, "name")).toEqual(["agenda.pdf", "Budget.csv", "moon.png", "Notes"]);
  });

  it("narrows them by words, owner, kind, person, room, date, stars and canvases", () => {
    expect(names({ ...NO_FILE_FILTERS, q: "BUD csv" })).toEqual(["Budget.csv"]);
    expect(names({ ...NO_FILE_FILTERS, owner: "mine" })).toEqual(["moon.png", "Notes"]);
    expect(names({ ...NO_FILE_FILTERS, owner: "shared" })).toEqual(["Budget.csv", "agenda.pdf"]);
    expect(names({ ...NO_FILE_FILTERS, types: ["pdfs", "images"] })).toEqual(["moon.png", "agenda.pdf"]);
    expect(names({ ...NO_FILE_FILTERS, from: "grace" })).toEqual(["Budget.csv", "agenda.pdf"]);
    expect(names({ ...NO_FILE_FILTERS, in: "random" })).toEqual(["moon.png"]);
    expect(names({ ...NO_FILE_FILTERS, date: { within: "7d" } })).toEqual(["Budget.csv", "moon.png"]);
    expect(names({ ...NO_FILE_FILTERS, starred: true })).toEqual(["moon.png"]);
    expect(names({ ...NO_FILE_FILTERS, canvases: true })).toEqual(["Notes"]);
  });

  it("counts the dialog's filters that are on", () => {
    expect(filtersOn(NO_FILE_FILTERS)).toBe(0);
    expect(filtersOn({ ...NO_FILE_FILTERS, from: "grace", in: "general", date: { within: "today" } })).toBe(3);
  });

  it("lists links by what they say and where they go", () => {
    const link = (title: string, url: string, createdAt: string): LibraryLink => ({ id: url, url, title, roomId: "general", messageId: "m", owner: ada, createdAt });
    const links = [link("Field guide", "https://example.com/guide", "2026-11-02T00:00:00Z"), link("https://maps.example", "https://maps.example", "2026-11-03T00:00:00Z")];
    expect(listLinks(links, { ...NO_FILE_FILTERS, q: "example.com" }, "newest", "ada").map(({ title }) => title)).toEqual(["Field guide"]);
    expect(listLinks(links, NO_FILE_FILTERS, "newest", "ada").map(({ title }) => title)).toEqual(["https://maps.example", "Field guide"]);
    expect(listLinks(links, NO_FILE_FILTERS, "name", "ada").map(({ title }) => title)).toEqual(["Field guide", "https://maps.example"]);
  });
});

describe("isWithin", () => {
  const now = new Date(2026, 10, 11, 15);
  it("takes today from local midnight, and a custom range's last day whole", () => {
    expect(isWithin(new Date(2026, 10, 11, 0, 5).toISOString(), { within: "today" }, now)).toBe(true);
    expect(isWithin(new Date(2026, 10, 10, 23, 55).toISOString(), { within: "today" }, now)).toBe(false);
    expect(isWithin(new Date(2026, 10, 3, 23, 59).toISOString(), { from: "2026-11-01", to: "2026-11-03" }, now)).toBe(true);
    expect(isWithin(new Date(2026, 10, 4, 0, 1).toISOString(), { from: "2026-11-01", to: "2026-11-03" }, now)).toBe(false);
    expect(isWithin(new Date(2026, 9, 31, 23, 59).toISOString(), { from: "2026-11-01", to: "2026-11-03" }, now)).toBe(false);
  });
});

describe("parsing what clients send", () => {
  it("takes new tabs of each kind, trimming their names, and refuses the rest", () => {
    expect(parseNewTab({ kind: "canvas", title: "  Notes " })).toEqual({ kind: "canvas", title: "Notes" });
    expect(parseNewTab({ kind: "link", title: "Guide", url: "https://example.com" })).toEqual({ kind: "link", title: "Guide", url: "https://example.com" });
    expect(parseNewTab({ kind: "file", title: "Moon", messageId: "m1" })).toEqual({ kind: "file", title: "Moon", messageId: "m1" });
    expect(parseNewTab({ kind: "link", title: "Run", url: "javascript:alert(1)" })).toBe("Links start with http:// or https://");
    expect(parseNewTab({ kind: "file", title: "Moon" })).toBe("Pick a file sent in the room");
    expect(parseNewTab({ kind: "table", title: "Data" })).toBe("That isn't something a tab can hold");
    expect(parseNewTab({ kind: "folder", title: "x".repeat(81) })).toMatch(/at most 80/);
    expect(parseNewTab([])).toBe("Expected a JSON object");
    expect(parseNewFolderItem({ kind: "folder", title: "Inner" })).toBe("That isn't something a tab can hold");
    expect(parseTabChange({ title: "" })).toBe("A tab needs a name");
  });

  it("takes an order of distinct ids, a canvas's document over a version, and marks", () => {
    expect(parseTabOrder({ tabIds: ["a", "b"] })).toEqual(["a", "b"]);
    expect(parseTabOrder({ tabIds: ["a", "a"] })).toBe("Expected the tabs' ids, once each");
    expect(parseCanvasSave({ body: EMPTY_CANVAS, version: 3 })).toEqual({ body: EMPTY_CANVAS, version: 3 });
    expect(parseCanvasSave({ body: '{"type":"paragraph"}', version: 3 })).toBe("A canvas is a document");
    expect(parseCanvasSave({ body: "x".repeat(MAX_CANVAS_LENGTH + 1), version: 3 })).toBe(CANVAS_TOO_LONG);
    expect(parseCanvasSave({ body: EMPTY_CANVAS, version: -1 })).toBe("A canvas's version is a number");
    expect(parseFileMark({ fileId: "f", roomId: "r", starred: false })).toEqual({ fileId: "f", roomId: "r", starred: false });
    expect(parseFileMark({ fileId: "f", roomId: "r", viewed: true })).toEqual({ fileId: "f", roomId: "r", viewed: true });
    expect(parseFileMark({ fileId: "f", roomId: "r" })).toBe("Nothing to mark");
    expect(isWebAddress("http://example.com")).toBe(true);
    expect(isWebAddress("ftp://example.com")).toBe(false);
  });
});

describe("The Files page's addresses", () => {
  it("names all files, canvases and starred files", () => {
    expect(workspacePageOf("/files")).toEqual({ page: "files", place: "all" });
    expect(workspacePageOf("/files/canvases")).toEqual({ page: "files", place: "canvases" });
    expect(workspacePageOf("/files/starred")).toEqual({ page: "files", place: "starred" });
    expect(workspacePageOf("/files/other")).toBeNull();
    expect(filesPath("all")).toBe("/files");
    expect(filesPath("starred")).toBe("/files/starred");
  });
});
