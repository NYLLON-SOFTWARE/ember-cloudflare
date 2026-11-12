import { createContext, useContext, useMemo, type MouseEvent, type ReactNode } from "react";
import {
  hasFilters,
  SEARCH_FLAGS,
  type Me,
  type Room,
  type RoomId,
  type Search,
  type SearchFilters,
  type SearchFlag,
  type SearchSort,
  type User,
  type UserId,
} from "@ember/protocol";
import { AtSign, Attachment, ChatBubbleEmpty, Link, Lock, MessageText, User as UserIcon, Xmark } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { roomName } from "@/lib/directs";
import { FLAG_LABELS } from "@/lib/search";
import { cn } from "@/lib/utils";

// The search box, after Slack's: Cmd+F or Ctrl+F, or Search in the rail or a room's header, opens it over
// the page, and a search in it opens its results (search-page.tsx).

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

/** What the box and the results page ask before they clear your recent searches. */
export const CONFIRM_CLEAR_SEARCHES = "Are you sure you want to clear your recent searches?";

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

/** Each filter's icon, as the project's owner chose them. */
export const FLAG_ICONS: Record<SearchFlag, (props: { className?: string }) => ReactNode> = {
  withMe: AtSign,
  hasLink: Link,
  hasFile: Attachment,
  inThread: MessageText,
};

/** A search's filters, without its words. */
export const filtersOf = ({ q: _, ...filters }: Search): SearchFilters => filters;

/** How a search's filters name its room and person. */
export interface SearchNames {
  /** The room, as the sidebar lists it, or null for one it doesn't. */
  room: (roomId: RoomId) => Room | null;
  /** A room's name, which for a DM names the others in it. */
  roomName: (room: Room) => string;
  /** Someone's name as the people directory lists them, or "Me". */
  person: (userId: UserId) => string;
}

/** The names a search's filters show: rooms from the sidebar's list, and people from the directory, you as "Me". */
export function useSearchNames(me: Me, rooms: readonly Room[]): SearchNames {
  const people = useContext(PeopleContext);
  const nameOf = useNameOf();
  return useMemo(
    () => ({
      room: (roomId: RoomId) => rooms.find((room) => room.id === roomId) ?? null,
      roomName: (room: Room) => roomName(room, me.id, nameOf),
      person: (userId: UserId) => (userId === me.id ? "Me" : (people.get(userId)?.name ?? "Someone")),
    }),
    [rooms, me.id, nameOf, people],
  );
}

/** A room's own icon, a private room's lock, or a DM's chat bubble, as a thread's panel shows them, `size` pixels square. */
export function RoomMark({ room, size }: { room: Room | null; size: number }) {
  if (room?.kind === "direct") return <ChatBubbleEmpty className="shrink-0" style={{ width: size, height: size }} />;
  // A private room without an icon of its own has a lock, as the sidebar shows it.
  if (room?.kind === "closed" && room.icon === null) return <Lock aria-hidden="true" className="shrink-0" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center leading-none" style={{ fontSize: size }}>
      <RoomIcon icon={room?.icon ?? null} size={size} />
    </span>
  );
}

/** How a token looks: a small rounded box, a line of the field tall, whose name is cut short where a line is too narrow. */
const TOKEN = "inline-flex max-w-[16em] min-w-0 items-center gap-1 rounded-md bg-hover px-1.5 py-0.5 text-[13px] leading-5 font-medium text-foreground";

/**
 * A filter's token: its icon and what it says, and where it can be taken away, a × after them, as the
 * whole token takes it away, as New direct message's people do, 44px tall for fingers.
 */
function Token({ icon, label, onRemove }: { icon: ReactNode; label: string; onRemove?: () => void }) {
  if (!onRemove) {
    return (
      <span className={TOKEN}>
        {icon}
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className={cn(TOKEN, "cursor-pointer hover:bg-border touch:min-h-11")}>
      {icon}
      <span className="truncate">{label}</span>
      <Xmark className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}

/** A filter as its token shows it: what it says, and its icon. */
interface FilterToken {
  filter: keyof SearchFilters;
  label: string;
  icon: ReactNode;
}

/**
 * A search's filters as tokens, in the order its address names them: the room's own icon and `in:` its
 * name, `from:` the person's, and the rest as the chips name them.
 */
function tokensOf(filters: SearchFilters, names: SearchNames): FilterToken[] {
  const tokens: FilterToken[] = [];
  if (filters.in !== undefined) {
    const room = names.room(filters.in);
    tokens.push({ filter: "in", label: `in:${room ? names.roomName(room) : "an unknown room"}`, icon: <RoomMark room={room} size={14} /> });
  }
  if (filters.from !== undefined) tokens.push({ filter: "from", label: `from:${names.person(filters.from)}`, icon: <UserIcon className="size-3.5 shrink-0" /> });
  for (const { flag } of SEARCH_FLAGS) {
    const Icon = FLAG_ICONS[flag];
    if (filters[flag] === true) tokens.push({ filter: flag, label: FLAG_LABELS[flag], icon: <Icon className="size-3.5 shrink-0" /> });
  }
  return tokens;
}

/** A search's filters as tokens, each with a × that takes it away when `onRemove` is given. */
export function SearchTokens({ filters, names, onRemove }: { filters: SearchFilters; names: SearchNames; onRemove?: (filter: keyof SearchFilters) => void }) {
  return tokensOf(filters, names).map(({ filter, label, icon }) => <Token key={filter} icon={icon} label={label} onRemove={onRemove && (() => onRemove(filter))} />);
}

/**
 * A search on one line: its tokens, and then its words, which stay whole while they take less than most
 * of the line, as the tokens give way first, their names cut short, and then cut off where even their
 * icons don't fit, as every filter at once on a narrow phone.
 */
export function SearchLine({ search, names, className }: { search: Search; names: SearchNames; className?: string }) {
  const filters = filtersOf(search);
  const filtered = hasFilters(filters);
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      {filtered && (
        <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <SearchTokens filters={filters} names={names} />
        </span>
      )}
      {search.q !== "" && <span className={cn("truncate", filtered && "max-w-[70%] shrink-0", className)}>{search.q}</span>}
    </span>
  );
}

/** A search as screen readers read it where it shows as tokens and words: what each token says, then the words. */
export const searchLabel = (search: Search, names: SearchNames) =>
  [...tokensOf(filtersOf(search), names).map(({ label }) => label), search.q.trim()].filter((part) => part !== "").join(" ");

/** A quick filter, after Slack's: a chip that's pressed while its filter is on. */
export function Chip({ pressed, onClick, children, ...props }: { pressed?: boolean; onClick: () => void; children: ReactNode; "aria-expanded"?: boolean; "aria-label"?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap text-foreground hover:bg-hover touch:min-h-11 touch:min-w-11 [&>svg]:size-4 [&>svg]:shrink-0",
        "aria-expanded:bg-hover aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground",
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * A row of chips, which wraps onto more lines, or at 900px and below scrolls sideways under a fading
 * right edge, which the last chip scrolls clear of.
 */
export const CHIPS_ROW =
  "md:flex-wrap max-md:overflow-x-auto max-md:pr-8 max-md:pl-3 max-md:[mask-image:linear-gradient(to_left,transparent,#000_32px)] max-md:[scrollbar-width:none]";
