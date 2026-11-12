import type { ComponentType } from "react";
import { Bookmark, CheckCircle, type IconoirIconProps } from "@/components/icons/iconoir";
import { SAVED_PATH, TODOS_PATH } from "@/hooks/use-route";
import { useOpenTodos } from "@/lib/saved";

// To-dos and Saved as shortcuts to their pages, for the places that link to them by a card or a row, as
// the phone's Home does in its row of cards above the rooms: each one's title, icon, address, and badge.

export interface KeptShortcut {
  page: "todos" | "saved";
  title: string;
  href: string;
  Icon: ComponentType<IconoirIconProps>;
  /** What its badge counts, or 0 for none. */
  useBadge: () => number;
}

const noBadge = () => 0;

export const KEPT_SHORTCUTS: KeptShortcut[] = [
  // Its badge counts the to-dos in progress.
  { page: "todos", title: "To-dos", href: TODOS_PATH, Icon: CheckCircle, useBadge: useOpenTodos },
  { page: "saved", title: "Saved", href: SAVED_PATH, Icon: Bookmark, useBadge: noBadge },
];
