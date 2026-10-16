/** How many outgoing connections one invocation can have open, beyond which its calls wait their turn. */
const CONNECTIONS = 6;

/** How many rooms one invocation calls at once. */
export const ROOMS_AT_ONCE = CONNECTIONS;

/** How many pushes one invocation sends at once, so that each one's deadline runs only while it's being sent. */
export const PUSHES_AT_ONCE = CONNECTIONS;

/** Runs `work` on each of `items`, `limit` at a time. */
export async function eachAtMost<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
