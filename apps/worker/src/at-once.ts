/** How many rooms one invocation calls at once: as many outgoing connections as it can have open. */
export const ROOMS_AT_ONCE = 6;

/** Runs `work` on each of `items`, `limit` at a time. */
export async function eachAtMost<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
