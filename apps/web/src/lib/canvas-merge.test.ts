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

  it("keeps both versions only of blocks you both changed, not of those beside them only one of you did", () => {
    // Sam saved Bravo and Charlie; Maya, who hadn't heard, changed Alpha and Bravo.
    const merged = mergeCanvas(doc("Alpha", "Bravo", "Charlie", "Delta"), doc("Alpha M", "Bravo M", "Charlie", "Delta"), doc("Alpha", "Bravo S", "Charlie S", "Delta"));
    expect(texts(merged.body)).toEqual(["Alpha M", "Bravo S", "Bravo M", "Charlie S", "Delta"]);
    expect(merged.conflicts).toBe(1);
  });

  it("keeps neither the old version of a block one of you changed nor one the other took out, however blocks moved", () => {
    const merged = mergeCanvas(doc("A", "B", "C"), doc("B", "New"), doc("A T", "B T", "C"));
    expect(texts(merged.body)).toEqual(["A T", "B T", "New"]);
  });

  it("never loses what either of you wrote, nor keeps a block twice, for any pair of edits", () => {
    // A small seeded generator, so a failure names the edits that made it.
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = (n: number) => Math.floor(random() * n);
    let made = 0;
    /** `base` as one person might leave it: some blocks changed, some taken out, some new ones put in. */
    const edited = (base: string[], who: string) => {
      const changed = new Map<string, string>();
      const removed = new Set<string>();
      const added: string[] = [];
      const blocks: string[] = [];
      for (const block of base) {
        const roll = random();
        if (roll < 0.2) {
          const next = `${block} by ${who} ${made++}`;
          changed.set(block, next);
          blocks.push(next);
        } else if (roll < 0.3) removed.add(block);
        else blocks.push(block);
        if (random() < 0.15) {
          const next = `new by ${who} ${made++}`;
          added.push(next);
          blocks.push(next);
        }
      }
      return { blocks, changed, removed, added };
    };
    for (let run = 0; run < 500; run++) {
      const base = Array.from({ length: 1 + pick(8) }, (_, index) => `block ${run}.${index}`);
      const [mine, theirs] = [edited(base, "me"), edited(base, "them")];
      const result = texts(mergeCanvas(doc(...base), doc(...mine.blocks), doc(...theirs.blocks)).body);
      const context = JSON.stringify({ base, mine: mine.blocks, theirs: theirs.blocks, result });
      expect(new Set(result).size, context).toBe(result.length);
      for (const block of [...mine.changed.values(), ...theirs.changed.values(), ...mine.added, ...theirs.added]) expect(result, context).toContain(block);
      for (const block of base) {
        const leftByBoth = !mine.changed.has(block) && !mine.removed.has(block) && !theirs.changed.has(block) && !theirs.removed.has(block);
        expect(result.includes(block), `${block} in ${context}`).toBe(leftByBoth);
      }
    }
  });

  it("takes either when you both made the same change", () => {
    expect(mergeCanvas(doc("a"), doc("b"), doc("b"))).toEqual({ body: doc("b"), conflicts: 0 });
  });
});
