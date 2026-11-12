// Merging a canvas someone else saved while you were writing in it, so neither's writing is lost: a
// three-way merge of the documents' blocks (paragraphs, headings, lists, ...), from the version both began
// at. A block only one of you changed takes that change; where you both changed the same blocks, both
// versions are kept, theirs first, for you to reconcile.

/** A canvas's document, as Tiptap's JSON has it: a doc whose content is its blocks. */
interface CanvasDoc {
  type: "doc";
  content?: unknown[];
}

export interface CanvasMerge {
  /** The merged document, as a canvas keeps it. */
  body: string;
  /** How many places you both changed, where both versions are kept. */
  conflicts: number;
}

/** Beyond this many blocks in each, nothing's matched, and both whole documents are kept, so the merge stays quick. */
const MAX_DIFFED_BLOCKS = 1000;

const blocksOf = (body: string): string[] => ((JSON.parse(body) as CanvasDoc).content ?? []).map((block) => JSON.stringify(block));

/**
 * The pairs of indices at which `a` and `b` hold the same block, in order, as many as can be: their
 * longest common subsequence.
 */
function matches(a: string[], b: string[]): Array<[number, number]> {
  if (a.length > MAX_DIFFED_BLOCKS || b.length > MAX_DIFFED_BLOCKS) return [];
  // lengths[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lengths = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i]![j] = a[i] === b[j] ? lengths[i + 1]![j + 1]! + 1 : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((block, index) => block === b[index]);

/**
 * Merges `mine` and `theirs`, each changed from `base`, block by block. Blocks unchanged in both, which
 * every version holds at the same place among the others, anchor the merge; between anchors, a stretch
 * only one side changed takes that side's, and one both changed differently keeps theirs, then mine.
 */
export function mergeCanvas(base: string, mine: string, theirs: string): CanvasMerge {
  if (mine === base || mine === theirs) return { body: theirs, conflicts: 0 };
  if (theirs === base) return { body: mine, conflicts: 0 };
  const original = blocksOf(base);
  const ours = blocksOf(mine);
  const others = blocksOf(theirs);
  const inOurs = new Map(matches(original, ours));
  const inOthers = new Map(matches(original, others));

  const merged: string[] = [];
  let conflicts = 0;
  let from = { base: 0, ours: 0, others: 0 };
  const settle = (to: typeof from) => {
    const was = original.slice(from.base, to.base);
    const ourStretch = ours.slice(from.ours, to.ours);
    const theirStretch = others.slice(from.others, to.others);
    if (same(ourStretch, was)) merged.push(...theirStretch);
    else if (same(theirStretch, was) || same(ourStretch, theirStretch)) merged.push(...ourStretch);
    else {
      merged.push(...theirStretch, ...ourStretch.filter((block) => !theirStretch.includes(block)));
      // Only adding, both of you, in the same place, changes nothing the other wrote.
      if (was.length > 0) conflicts++;
    }
  };
  for (let index = 0; index < original.length; index++) {
    const ourIndex = inOurs.get(index);
    const theirIndex = inOthers.get(index);
    if (ourIndex === undefined || theirIndex === undefined || ourIndex < from.ours || theirIndex < from.others) continue;
    settle({ base: index, ours: ourIndex, others: theirIndex });
    merged.push(original[index]!);
    from = { base: index + 1, ours: ourIndex + 1, others: theirIndex + 1 };
  }
  settle({ base: original.length, ours: ours.length, others: others.length });
  const doc: CanvasDoc = { type: "doc", content: merged.map((block) => JSON.parse(block) as unknown) };
  return { body: JSON.stringify(doc), conflicts };
}
