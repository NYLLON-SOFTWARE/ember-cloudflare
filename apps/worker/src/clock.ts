/**
 * The clock scheduled messages compare their send time against, so tests can move it without waiting.
 * Production uses the system clock.
 */
export type Now = () => number;

let current: Now = () => Date.now();

/** Milliseconds since the epoch, as the scheduled-message clock has them. */
export const now = (): number => current();

/** The same instant as UTC ISO-8601 with a `Z`, as the room stores times. */
export const isoNow = (): string => new Date(current()).toISOString();

/** Replaces the clock. Tests use this so a scheduled send is observed by advancing time. */
export function setNow(next: Now): void {
  current = next;
}

/** Restores the system clock. */
export function resetNow(): void {
  current = () => Date.now();
}
