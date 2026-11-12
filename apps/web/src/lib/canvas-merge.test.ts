import { describe, expect, it } from "vitest";
import { mergeCanvas } from "./canvas-merge";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
/** A canvas whose blocks are paragraphs of `texts`. */
const doc = (...texts: string[]) => JSON.stringify({ type: "doc", content: texts.map(paragraph) });
const texts = (body: string) => (JSON.parse(body) as { content: Array<{ content: Array<{ text: string }> }> }).content.map((block) => block.content[0]!.text);

describe("mergeCanvas", () => {
  it("takes theirs where you changed nothing, and yours where they changed nothing", () => {
    expect(mergeCanvas(doc("a"), doc("a"), doc("a", "b"))).toEqual({ body: doc("a", "b"), conflicts: 0 });
    expect(mergeCanvas(doc("a"), doc("a", "mine"), doc("a"))).toEqual({ body: doc("a", "mine"), conflicts: 0 });
  });

  it("keeps both people's changes to different blocks", () => {
    const merged = mergeCanvas(doc("one", "two", "three"), doc("one!", "two", "three"), doc("one", "two", "three", "four"));
    expect(texts(merged.body)).toEqual(["one!", "two", "three", "four"]);
    expect(merged.conflicts).toBe(0);
  });

  it("keeps a block one deleted and the other left alone deleted, and what the other added", () => {
    const merged = mergeCanvas(doc("one", "two", "three"), doc("one", "three"), doc("zero", "one", "two", "three"));
    expect(texts(merged.body)).toEqual(["zero", "one", "three"]);
  });

  it("keeps both versions of a block you both changed, theirs first, and counts it", () => {
    const merged = mergeCanvas(doc("intro", "body"), doc("intro", "MAYA"), doc("intro", "SAM"));
    expect(texts(merged.body)).toEqual(["intro", "SAM", "MAYA"]);
    expect(merged.conflicts).toBe(1);
  });

  it("loses nothing when both of you write into an empty canvas", () => {
    const merged = mergeCanvas(JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }), doc("MAYA-LOCAL-EDIT-1"), doc("SAM-LOCAL-EDIT-1"));
    expect(texts(merged.body)).toEqual(["SAM-LOCAL-EDIT-1", "MAYA-LOCAL-EDIT-1"]);
  });

  it("keeps what you both added in the same place, theirs first, as no conflict", () => {
    expect(mergeCanvas(doc("a"), doc("a", "mine"), doc("a", "theirs"))).toEqual({ body: doc("a", "theirs", "mine"), conflicts: 0 });
  });

  it("takes either when you both made the same change", () => {
    expect(mergeCanvas(doc("a"), doc("b"), doc("b"))).toEqual({ body: doc("b"), conflicts: 0 });
  });
});
