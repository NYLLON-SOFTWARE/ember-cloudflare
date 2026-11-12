import { createContext, type MouseEvent } from "react";
import type { RoomId, Search, SearchSort } from "@ember/protocol";

// Opening the search box (search-box.tsx), apart from the box, which loads with the pages.

/** What the search box opens with. */
export interface SearchBoxOptions {
  /** The link that opened it, which gets focus back as it closes, or null when a key did. */
  opener: HTMLElement | null;
  /** The search in it, as the results page has it. */
  search?: Search;
  /** How the results it opens are sorted. */
  sort?: SearchSort;
  /** The room it was opened in, which "In this room" names, and which a box opened without a search starts in. */
  roomId?: RoomId | null;
}

export type OpenSearch = (options: SearchBoxOptions) => void;

/** Opens the search box, for the rail, a room's header and the results page. */
export const OpenSearchContext = createContext<OpenSearch>(() => {});

/**
 * A link's click that opens the search box in place, as Search does in the rail and a room's header,
 * leaving one with a modifier key to follow the link, as into a new tab.
 */
export function opensSearch(open: OpenSearch, options: Omit<SearchBoxOptions, "opener"> = {}) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open({ ...options, opener: event.currentTarget });
  };
}
