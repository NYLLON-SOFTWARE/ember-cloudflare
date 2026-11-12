import type { Me, Room, User } from "@ember/protocol";
import { parseCanvasSave, type Canvas, type OpenedTab } from "@ember/protocol/library";
import type { Editor } from "@tiptap/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "./canvas-editor";

const maya: Me = { id: "maya", name: "Maya", administrator: false };
const sam = { id: "sam", name: "Sam" };
const room: Room = { id: "design", name: "design", kind: "open", icon: null };

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const doc = (...blocks: object[]) => JSON.stringify({ type: "doc", content: blocks });
const canvas = (body: string, version: number, by: User = maya): Canvas => ({ body, version, updatedAt: "2026-11-12T10:00:00.000Z", updatedBy: by });
const opened = (body: string): OpenedTab => ({
  tab: { id: "t1", roomId: "design", kind: "canvas", title: "Plan", creator: maya, createdAt: "2026-11-12T09:00:00.000Z", updatedAt: "2026-11-12T09:00:00.000Z" },
  canvas: canvas(body, 1),
});

/** The canvas's editor, as Tiptap leaves it on the element it edits. */
const editorOf = () => (document.querySelector(".ProseMirror") as HTMLElement & { editor: Editor }).editor;

/** Types `text` as a paragraph at the end of the canvas, as someone typing there would. */
const typeAtEnd = (text: string) => act(() => void editorOf().commands.insertContentAt(editorOf().state.doc.content.size, paragraph(text)));

/** What the canvas's saves sent, in order. */
const saves = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === "PUT")
    .map(([, init]) => JSON.parse(String(init!.body)) as { body: string; version: number });

const renderCanvas = (body: string) => render(<CanvasEditor room={room} me={maya} opened={opened(body)} onSaved={vi.fn()} onFailed={vi.fn()} />);

afterEach(() => vi.restoreAllMocks());

describe("Canvas", () => {
  it("keeps what you typed when someone else saved first, saving the two merged over theirs", async () => {
    const theirs = canvas(doc(paragraph("intro"), paragraph("SAM")), 2, sam);
    let answered = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init!.body)) as { body: string; version: number };
      return answered++ === 0 ? Response.json({ error: "changed", canvas: theirs }, { status: 409 }) : Response.json({ ...opened(sent.body), canvas: canvas(sent.body, sent.version + 1) });
    });
    renderCanvas(doc(paragraph("intro")));
    typeAtEnd("MAYA");

    await waitFor(() => expect(saves()).toHaveLength(2), { timeout: 5000 });
    expect(saves()[1]).toEqual({ body: doc(paragraph("intro"), paragraph("SAM"), paragraph("MAYA")), version: 2 });
    expect(editorOf().getText()).toBe("intro\n\nSAM\n\nMAYA");
    expect(screen.getByRole("alert")).toHaveTextContent("Merged with someone else’s changes.");
  });

  it("keeps both versions where you both changed the same part, and Undo can't take theirs back", async () => {
    const theirs = canvas(doc(paragraph("SAM-LOCAL-EDIT-1")), 2, sam);
    let answered = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init!.body)) as { body: string; version: number };
      return answered++ === 0 ? Response.json({ error: "changed", canvas: theirs }, { status: 409 }) : Response.json({ ...opened(sent.body), canvas: canvas(sent.body, sent.version + 1) });
    });
    renderCanvas(doc({ type: "paragraph" }));
    act(() => void editorOf().commands.insertContent("MAYA-LOCAL-EDIT-1"));

    await waitFor(() => expect(saves()).toHaveLength(2), { timeout: 5000 });
    expect(editorOf().getText()).toBe("SAM-LOCAL-EDIT-1\n\nMAYA-LOCAL-EDIT-1");
    expect(screen.getByRole("alert")).toHaveTextContent("Both versions are kept, theirs first.");

    act(() => void editorOf().commands.undo());
    expect(editorOf().getText()).toContain("SAM-LOCAL-EDIT-1");
  });

  it("sends what's unsaved as the page goes away, and asks before leaving while it is", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(opened(doc())));
    renderCanvas(doc(paragraph("intro")));
    typeAtEnd("RELOAD-FAST");

    const leaving = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event("pagehide"));
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/rooms/design/tabs/t1/canvas");
    expect(init).toMatchObject({ method: "PUT", keepalive: true });
    expect(saves()[0]).toEqual({ body: doc(paragraph("intro"), paragraph("RELOAD-FAST")), version: 1 });
  });

  it("writes only what the server takes as a canvas, whatever the toolbar makes", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(opened(doc())));
    renderCanvas(doc({ type: "paragraph" }));
    act(() => {
      const editor = editorOf();
      editor.chain().insertContent("Plan").toggleHeading({ level: 1 }).run();
      editor.commands.insertContentAt(editor.state.doc.content.size, [
        { type: "bulletList", content: [{ type: "listItem", content: [paragraph("one")] }] },
        { type: "orderedList", attrs: { start: 3 }, content: [{ type: "listItem", content: [paragraph("two")] }] },
        { type: "blockquote", content: [paragraph("said")] },
        { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "a", marks: [{ type: "bold" }, { type: "italic" }, { type: "strike" }, { type: "underline" }] }, { type: "text", text: "b", marks: [{ type: "code" }] }, { type: "hardBreak" }, { type: "text", text: "Ember", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] },
      ]);
    });
    expect(parseCanvasSave({ body: JSON.stringify(editorOf().getJSON()), version: 1 })).toMatchObject({ version: 1 });
  });

  it("opens a canvas holding what it can't show read-only, never saving over it", async () => {
    vi.spyOn(globalThis, "fetch");
    renderCanvas(doc(paragraph("kept"), { type: "iframe", attrs: { src: "https://example.com" } }));
    expect(screen.getByRole("status")).toHaveTextContent("can’t be edited here");
    expect(editorOf().isEditable).toBe(false);
    window.dispatchEvent(new Event("pagehide"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
