import type { ComponentType } from "react";
import { Bookmark, CheckCircle, type IconoirIconProps } from "@/components/icons/iconoir";
import { SAVED_PATH, TODOS_PATH } from "@/hooks/use-route";
import { useKeptCounts, type KeptCounts } from "@/lib/saved";

// To-dos and Saved as shortcuts to their pages, for the places that link to them by a card or a row, as
// the phone's Home does in its row of cards above the rooms: each one's title, icon, address, and what its
// counts say.

export interface KeptShortcut {
  page: "todos" | "saved";
  title: string;
  href: string;
  Icon: ComponentType<IconoirIconProps>;
  /** Its counts, as a card's second line says them: "3 open · 1 overdue", or "12 items". */
  detail: (counts: KeptCounts) => string;
  /** How many need you now, for a badge, or 0. */
  badge: (counts: KeptCounts) => number;
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const KEPT_SHORTCUTS: KeptShortcut[] = [
  {
    page: "todos",
    title: "To-dos",
    href: TODOS_PATH,
    Icon: CheckCircle,
    detail: ({ openTodos, overdueTodos }) => [`${openTodos} open`, ...(overdueTodos > 0 ? [`${overdueTodos} overdue`] : [])].join(" · "),
    badge: ({ overdueTodos }) => overdueTodos,
  },
  { page: "saved", title: "Saved", href: SAVED_PATH, Icon: Bookmark, detail: ({ savedItems }) => counted(savedItems, "item", "items"), badge: () => 0 },
];

/** The lists' counts as they are now, for `detail` and `badge`. */
export { useKeptCounts };
