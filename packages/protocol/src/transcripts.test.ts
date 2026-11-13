import { describe, expect, it } from "vitest";
import type { DirectRoom, SharedRoom } from "./index.ts";
import {
  parseTranscriptFormat,
  roomTranscriptMarkdown,
  roomTranscriptPath,
  transcriptJson,
  transcriptRoomOf,
  transcriptTitle,
  workspaceTranscriptMarkdown,
  workspaceTranscriptPath,
  type RoomTranscript,
  type TranscriptMessage,
} from "./transcripts.ts";

const design: SharedRoom = { id: "design", name: "Design", kind: "open", icon: null };
const ada = { id: "ada", name: "Ada Lovelace" };
const grace = { id: "grace", name: "Grace Hopper" };
const ping: DirectRoom = { id: "d1", kind: "direct", members: [ada, grace], activeAt: "2026-11-13T12:00:00.000Z" };

const parent: TranscriptMessage = {
  id: "m1",
  author: ada,
  createdAt: "2026-11-13T12:00:00.000Z",
  text: "Shall we ship it?",
  body: "<p>Shall we ship it?</p>",
};
const reply: TranscriptMessage = {
  id: "m2",
  author: grace,
  createdAt: "2026-11-13T12:01:00.000Z",
  text: "Yes",
  parentId: "m1",
  alsoSent: false,
};
const later: TranscriptMessage = {
  id: "m3",
  author: ada,
  createdAt: "2026-11-13T12:02:00.000Z",
  text: "Done.",
};

const roomTranscript = (messages: TranscriptMessage[]): RoomTranscript => ({
  room: { id: "design", name: "Design", kind: "open" },
  exportedAt: "2026-11-13T12:03:00.000Z",
  messages,
});

describe("Transcript addresses", () => {
  it("names a room's transcript, and JSON when that's asked for", () => {
    expect(roomTranscriptPath("design")).toBe("/api/rooms/design/transcript");
    expect(roomTranscriptPath("design", "json")).toBe("/api/rooms/design/transcript?format=json");
    expect(roomTranscriptPath("a/b")).toBe("/api/rooms/a%2Fb/transcript");
  });

  it("names every conversation's transcript the same way", () => {
    expect(workspaceTranscriptPath()).toBe("/api/transcripts");
    expect(workspaceTranscriptPath("markdown")).toBe("/api/transcripts");
    expect(workspaceTranscriptPath("json")).toBe("/api/transcripts?format=json");
  });

  it("reads Markdown when format is missing or blank, JSON when it says so, and refuses anything else", () => {
    expect(parseTranscriptFormat(null)).toBe("markdown");
    expect(parseTranscriptFormat("")).toBe("markdown");
    expect(parseTranscriptFormat("markdown")).toBe("markdown");
    expect(parseTranscriptFormat("json")).toBe("json");
    expect(parseTranscriptFormat("csv")).toBeNull();
    expect(parseTranscriptFormat("JSON")).toBeNull();
  });
});

describe("A transcript's room name", () => {
  it("keeps a shared room's name, and names a DM for the others in it", () => {
    expect(transcriptTitle(design, ada.id)).toBe("Design");
    expect(transcriptTitle(ping, ada.id)).toBe("Grace Hopper");
    expect(transcriptTitle(ping, grace.id)).toBe("Ada Lovelace");
    expect(transcriptTitle({ ...ping, members: [ada] }, ada.id)).toBe("Ada Lovelace");
    expect(transcriptTitle({ ...ping, members: [ada, grace, { id: "lin", name: "Linus" }] }, ada.id)).toBe("Grace Hopper and Linus");
    expect(
      transcriptTitle({ ...ping, members: [ada, grace, { id: "lin", name: "Linus" }, { id: "alan", name: "Alan" }] }, ada.id),
    ).toBe("Grace Hopper, Linus, and Alan");
  });

  it("names the room as the transcript lists it, without its members", () => {
    expect(transcriptRoomOf(design, ada.id)).toEqual({ id: "design", name: "Design", kind: "open" });
    expect(transcriptRoomOf(ping, ada.id)).toEqual({ id: "d1", name: "Grace Hopper", kind: "direct" });
  });
});

describe("Transcript JSON", () => {
  it("writes the room, when it was exported, and each message, with markup and the thread", () => {
    const json = JSON.parse(transcriptJson(roomTranscript([parent, reply])));
    expect(json).toEqual({
      room: { id: "design", name: "Design", kind: "open" },
      exportedAt: "2026-11-13T12:03:00.000Z",
      messages: [parent, reply],
    });
  });

  it("writes every room in a workspace transcript", () => {
    const json = JSON.parse(
      transcriptJson({
        exportedAt: "2026-11-13T12:03:00.000Z",
        rooms: [roomTranscript([parent])],
      }),
    );
    expect(json.rooms).toHaveLength(1);
    expect(json.rooms[0].room.name).toBe("Design");
  });
});

describe("Transcript Markdown", () => {
  it("starts with the room's name and when it was exported, then each message", () => {
    expect(roomTranscriptMarkdown(roomTranscript([parent, later]))).toBe(
      `# Design

Exported 2026-11-13T12:03:00.000Z.

**Ada Lovelace** · 2026-11-13T12:00:00.000Z

Shall we ship it?

**Ada Lovelace** · 2026-11-13T12:02:00.000Z

Done.
`,
    );
  });

  it("puts replies under their parent, quoted, even when the reply was also sent to the room", () => {
    const markdown = roomTranscriptMarkdown(roomTranscript([parent, { ...reply, alsoSent: true }, later]));
    expect(markdown).toContain("**Ada Lovelace** · 2026-11-13T12:00:00.000Z");
    expect(markdown).toContain("> **Grace Hopper** · 2026-11-13T12:01:00.000Z");
    expect(markdown).toContain("> Yes");
    expect(markdown.indexOf("Shall we ship it?")).toBeLessThan(markdown.indexOf("Grace Hopper"));
    expect(markdown.indexOf("Grace Hopper")).toBeLessThan(markdown.indexOf("Done."));
    expect(markdown.match(/Grace Hopper/g)).toHaveLength(1);
  });

  it("nests a reply in a block quote under its parent, so a viewer attaches it to the thread", () => {
    const markdown = roomTranscriptMarkdown(roomTranscript([parent, reply, later]));
    expect(markdown).toContain("> **Grace Hopper** · 2026-11-13T12:01:00.000Z");
    expect(markdown).toMatch(/^> Yes$/m);
    expect(markdown).toContain("\n>\n> Yes");
    expect(markdown.indexOf("Shall we ship it?")).toBeLessThan(markdown.indexOf("> **Grace Hopper**"));
    expect(markdown.indexOf("> **Grace Hopper**")).toBeLessThan(markdown.indexOf("Done."));
    expect(markdown).not.toMatch(/^ {2}\*\*Grace Hopper\*\*/m);
  });

  it("says when a message was deleted, and still lists the replies that kept its place", () => {
    const gone: TranscriptMessage = { ...parent, text: "", deleted: true };
    const markdown = roomTranscriptMarkdown(roomTranscript([gone, reply]));
    expect(markdown).toContain("_Deleted._");
    expect(markdown).toContain("> Yes");
  });

  it("names a live image-only message as an image, not as deleted", () => {
    const image: TranscriptMessage = { ...parent, text: "", attachment: "image" };
    const markdown = roomTranscriptMarkdown(roomTranscript([image]));
    expect(markdown).toContain("_Image._");
    expect(markdown).not.toContain("_Deleted._");
    expect(roomTranscriptMarkdown(roomTranscript([{ ...parent, text: "", deleted: true }]))).toContain("_Deleted._");
    expect(roomTranscriptMarkdown(roomTranscript([{ ...parent, text: "", attachment: "file" }]))).toContain("_File._");
    expect(roomTranscriptMarkdown(roomTranscript([{ ...parent, text: "", cards: true }]))).toContain("_Card._");
  });

  it("writes a message's text, its author's name and the room's as they were typed, not as Markdown", () => {
    const markdown = roomTranscriptMarkdown({
      room: { id: "design", name: "Design *lab*", kind: "open" },
      exportedAt: "2026-11-13T12:03:00.000Z",
      messages: [
        {
          ...parent,
          author: { id: "ada", name: "Ada *Lovelace*" },
          text: "*bold*\n# heading\n<em>html</em>",
        },
      ],
    });
    expect(markdown).toContain("\\*bold\\*");
    expect(markdown).toContain("\\# heading");
    expect(markdown).toContain("&lt;em&gt;html&lt;/em&gt;");
    expect(markdown).not.toMatch(/(^|\n)# heading(\n|$)/);
    expect(markdown).not.toContain("*bold*");
    expect(markdown).toContain("Ada \\*Lovelace\\*");
    expect(markdown).toContain("# Design \\*lab\\*");
    expect(markdown).not.toContain("# Design *lab*");
  });

  it("keeps a reply whose parent isn't in the transcript, so nothing is dropped", () => {
    expect(roomTranscriptMarkdown(roomTranscript([reply]))).toContain("**Grace Hopper**");
  });

  it("writes an empty room as its heading alone", () => {
    expect(roomTranscriptMarkdown(roomTranscript([]))).toBe("# Design\n\nExported 2026-11-13T12:03:00.000Z.\n");
  });

  it("joins every room under Your conversations, and says so when there are none", () => {
    expect(workspaceTranscriptMarkdown({ exportedAt: "2026-11-13T12:03:00.000Z", rooms: [] })).toBe("# Your conversations\n\nExported 2026-11-13T12:03:00.000Z.\n");
    const markdown = workspaceTranscriptMarkdown({
      exportedAt: "2026-11-13T12:03:00.000Z",
      rooms: [roomTranscript([parent]), { room: { id: "d1", name: "Grace Hopper", kind: "direct" }, exportedAt: "2026-11-13T12:03:00.000Z", messages: [] }],
    });
    expect(markdown).toContain("# Your conversations");
    expect(markdown).toContain("# Design");
    expect(markdown).toContain("# Grace Hopper");
    expect(markdown).toContain("\n---\n");
  });
});
