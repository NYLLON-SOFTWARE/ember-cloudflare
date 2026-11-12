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
 * Merges a stretch both sides changed, `ours` and `theirs`, from `was`, onto `merged`, block by block,
 * answering how many blocks both changed, whose versions are both kept, theirs first. A block only one side
 * changed takes that side's version, and one that a side only left as it was never stays beside the other's.
 */
function mergeStretch(was: string[], ours: string[], theirs: string[], merged: string[]): number {
  const original = new Set(was);
  // Where each side's blocks are its changes to the blocks at the same places, as when people edit
  // paragraphs where they are, each block is merged with its own.
  const inPlace = (side: string[]) => side.length === was.length && side.every((block, index) => block === was[index] || !original.has(block));
  if (inPlace(ours) && inPlace(theirs)) {
    let conflicts = 0;
    was.forEach((block, index) => {
      const [mine, other] = [ours[index]!, theirs[index]!];
      if (mine === block || mine === other) merged.push(other);
      else if (other === block) merged.push(mine);
      else {
        merged.push(other, mine);
        conflicts++;
      }
    });
    return conflicts;
  }
  // Otherwise blocks moved, came or went: theirs, but for blocks of the original that we changed or took
  // out, then what we wrote that they haven't.
  const kept = new Set(ours);
  const theirsLeft = theirs.filter((block) => !original.has(block) || kept.has(block));
  const oursNew = ours.filter((block) => !original.has(block) && !theirs.includes(block));
  merged.push(...theirsLeft, ...oursNew);
  // Only adding, or taking out, changes nothing the other wrote; both writing new blocks in place of the same ones does.
  return oursNew.length > 0 && theirs.some((block) => !original.has(block)) && was.length > 0 ? 1 : 0;
}

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
    else conflicts += mergeStretch(was, ourStretch, theirStretch, merged);
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
