// Sortable ids: 10 chars of millisecond time + 6 random chars, base36.
// Lexicographic order matches creation order, which history paging relies on.
// Each room has a single writer (its Durable Object), so bumping the clock on
// a collision is enough to keep ids from one room strictly increasing.

let last = 0;

export function sortableId(now = Date.now()): string {
  const time = Math.max(now, last + 1);
  last = time;
  const random = crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).padStart(7, "0").slice(-6);
  return time.toString(36).padStart(10, "0") + random;
}
