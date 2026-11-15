/** How many unread a badge shows: up to 9, then "9+", as the DMs page's rows and the rail's DMs count them. */
export const unreadBadge = (count: number) => (count > 9 ? "9+" : String(count));
