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

const ALPHANUMERICS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** `length` random letters and digits, as Ruby's `SecureRandom.alphanumeric` makes them, each as likely as the next. */
export function alphanumeric(length: number): string {
  let text = "";
  while (text.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // 248 is the largest multiple of 62 below 256, so every character is as likely as the next.
      if (byte < 248 && text.length < length) text += ALPHANUMERICS[byte % ALPHANUMERICS.length];
    }
  }
  return text;
}
