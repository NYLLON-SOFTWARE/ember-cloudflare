// Home's Drafts & sent card counts drafts as the sidebar's link does.
export { useDraftCount } from "@/hooks/use-draft-count";

/** A count as a card has room for: up to 99, then "99+". */
export const cappedCount = (count: number): string => (count > 99 ? "99+" : String(count));
