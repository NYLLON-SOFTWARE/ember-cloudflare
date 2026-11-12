import { useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { workspacePageOf, type ActivityItem, type Me, type RoomId, type SidebarRoom, type UserId } from "@ember/protocol";
import {
  ArrowLeft,
  AtSign,
  ChatBubbleEmpty,
  CheckCircle,
  Emoji,
  FilterList,
  MessageText,
  Search,
  UserPlus,
  Xmark,
} from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTitle } from "@/hooks/use-title";
import type { ActivityState } from "@/hooks/use-activity";
import { ALL_ACTIVITY, filterCount, shows, type ActivityFilter, type ActivityFilterKind, type ActivityNames, type ActivityTab } from "@/lib/activity-feed";
import { roomName } from "@/lib/directs";
import { dateLabel, timeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";
import { ProfilePanel, useProfilePane } from "./profile-pane";
import type { RoomPanes } from "./room-view";
import { ONE_PANE, SplitPanes, type Pane, type PaneStack } from "./split-panes";
import { UserAvatar } from "./user-avatar";

// Activity, as Slack's is: a feed of what's happened to you beside the conversation an item opens, with
// its thread, or the profile of someone in it, in a third pane, each pane as wide as you drag it.

/** Where an item opened: its room, around its message, with its thread when it's a reply, or one opened since. */
export interface ActivityPlace {
  itemId: number;
  roomId: RoomId;
  messageId?: string;
  threadId?: string;
  replyId?: string;
}

interface Props {
  me: Me;
  rooms: SidebarRoom[];
  activity: ActivityState;
  /** The room `place` names, shown in a pane, its thread put in another by `panes`. */
  renderRoom: (place: ActivityPlace, panes: RoomPanes) => ReactNode;
  /** Called with which of the feed, conversation, thread and profile are open, and what closes the deepest, for a phone's back stack. */
  onPaneStack?: (stack: PaneStack) => void;
}

const TABS: Array<{ tab: ActivityTab; label: string }> = [
  { tab: "all", label: "All" },
  { tab: "direct", label: "DMs" },
  { tab: "mention", label: "Mentions" },
  { tab: "thread", label: "Threads" },
];

const FILTERS: Array<{ kind: ActivityFilterKind; label: string }> = [
  { kind: "direct", label: "DMs" },
  { kind: "mention", label: "Mentions" },
  { kind: "thread", label: "Threads" },
  { kind: "reaction", label: "Reactions" },
  { kind: "invitation", label: "Invitations" },
  { kind: "apps", label: "Apps" },
];

/** Where an item opens its conversation: at its message, and a reply in its thread, at the reply. */
export function placeOf(item: ActivityItem): ActivityPlace {
  const place: ActivityPlace = { itemId: item.id, roomId: item.roomId };
  if (item.messageId === null) return place;
  if (item.parentId !== null) return { ...place, messageId: item.parentId, threadId: item.parentId, replyId: item.messageId };
  return { ...place, messageId: item.messageId };
}

export function ActivityPage({ me, rooms, activity, renderRoom, onPaneStack }: Props) {
  useTitle("Activity");
  const { feed, loadOlder, mark, markAllRead } = activity;
  const profile = useProfilePane();
  const [filter, setFilter] = useState<ActivityFilter>(ALL_ACTIVITY);
  const [place, setPlace] = useState<ActivityPlace | null>(null);
  const [threadPane, setThreadPane] = useState<HTMLElement | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const [hiddenPanes, setHiddenPanes] = useState(0);
  const names = useActivityNames(rooms, me);
  const shown = useMemo(() => feed.items.filter((item) => shows(filter, item, names)), [feed.items, filter, names]);
  const roomOpen = place !== null && rooms.some((room) => room.id === place.roomId);
  const conversation = place !== null && roomOpen;

  const open = (item: ActivityItem) => {
    setPlace(placeOf(item));
    profile?.close();
    if (!item.read) mark([item.id], true);
  };
  const closeThread = useCallback(() => setPlace((place) => place && { ...place, threadId: undefined, replyId: undefined }), []);
  const closeConversation = () => {
    setPlace(null);
    profile?.close();
  };

  // A thread opened from the conversation shown opens in the pane beside it, as Slack's do, rather than
  // going to the room's page; anything else the conversation links to goes there.
  const openThreadForLink = (event: MouseEvent) => {
    if (!place || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) return;
    const target = workspacePageOf(link.pathname);
    if (target?.page !== "room" || target.roomId !== place.roomId || target.threadId === undefined) return;
    event.preventDefault();
    profile?.close();
    setPlace({ ...place, threadId: target.threadId, replyId: target.replyId });
  };

  const side = profile?.userId ? "profile" : place?.threadId !== undefined ? "thread" : null;
  // On phones, the feed shows alone until an item opens, rather than the bubble that waits for one.
  const phone = useMediaQuery(ONE_PANE);
  const panes: Pane[] = [
    {
      id: "feed",
      label: "Resize activity",
      minWidth: 320,
      defaultShare: side ? 0.3 : 0.42,
      content: (
        <Feed
          me={me}
          shown={shown}
          activity={activity}
          filter={filter}
          onFilter={setFilter}
          rooms={rooms}
          names={names}
          openedId={place?.itemId ?? null}
          selected={selected}
          onSelected={setSelected}
          onOpen={open}
          onLoadOlder={loadOlder}
          onMarkAllRead={markAllRead}
        />
      ),
    },
    {
      id: "conversation",
      label: "Resize activity",
      onClose: conversation ? closeConversation : undefined,
      minWidth: 380,
      defaultShare: side ? 0.4 : 0.58,
      content:
        place && roomOpen ? (
          <div className="flex h-full min-h-0 flex-col" onClickCapture={openThreadForLink}>
            {/* Where the row's too narrow for the feed beside it; phones' back stack is the mobile layout's. */}
            {hiddenPanes > 0 && !phone && <BackToActivity onClick={closeConversation} />}
            <div className="min-h-0 flex-1">{renderRoom(place, { thread: threadPane, onCloseThread: closeThread })}</div>
          </div>
        ) : (
          <NothingOpen />
        ),
    },
  ];
  if (phone && !conversation) panes.pop();
  if (side === "thread" && roomOpen)
    panes.push({ id: "thread", label: "Resize thread", minWidth: 300, defaultShare: 0.3, onClose: closeThread, content: <div ref={setThreadPane} className="h-full min-h-0" /> });
  if (side === "profile" && profile)
    panes.push({ id: "profile", label: "Resize profile", minWidth: 300, defaultShare: 0.3, onClose: profile.close, content: <ProfilePanel userId={profile.userId!} me={me} pane={profile} placement="pane" /> });

  return (
    <>
      {/* On phones, the header with the drawer's button over the feed, which a conversation's own header
          takes the place of, and the panes from 900px wide. */}
      <div className={cn("hidden", !conversation && "max-md:contents")}>
        <PageHeader>
          {/* The feed's heading names the page, for screen readers, here too. */}
          <span aria-hidden="true" className="text-base font-[650]">
            Activity
          </span>
        </PageHeader>
      </div>
      <SplitPanes
        layoutKey="activity"
        panes={panes}
        onCollapsed={setHiddenPanes}
        onLayout={onPaneStack}
        className={cn("col-start-2 col-end-[-1] row-span-2 row-start-1 bg-background max-md:col-start-1", !conversation && "max-md:row-span-1 max-md:row-start-2")}
      />
    </>
  );
}

/** Who an item is from and where it happened, by name, for the feed and its search. */
function useActivityNames(rooms: SidebarRoom[], me: Me): ActivityNames {
  const people = useContext(PeopleContext);
  const nameOf = useNameOf();
  return useMemo(() => {
    const byId = new Map(rooms.map((room) => [room.id, room]));
    return {
      nameOf: (userId: UserId) => (userId === me.id ? "You" : nameOf({ id: userId, name: people.get(userId)?.name ?? "Someone" })),
      roomNameOf: (roomId: RoomId) => {
        const room = byId.get(roomId);
        if (!room) return "a room";
        return room.kind === "direct" ? roomName(room, me.id, nameOf) : `#${room.name}`;
      },
      isBot: (userId: UserId) => people.get(userId)?.role === "bot",
    };
  }, [rooms, me.id, people, nameOf]);
}

/** Slack's chat bubble where the conversation goes until an item opens one. */
function NothingOpen() {
  return (
    <MainContent className="grid h-full place-content-center justify-items-center gap-3 border-l bg-background p-6 text-center text-muted-foreground">
      <ChatBubbleEmpty className="size-24 text-hover" strokeWidth={1} />
      <p className="text-sm">Pick something from your activity to see it here.</p>
    </MainContent>
  );
}

function BackToActivity({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 pt-[env(safe-area-inset-top)] text-sm font-semibold hover:bg-hover">
      <ArrowLeft className="size-[18px]" />
      Activity
    </button>
  );
}

interface FeedProps {
  me: Me;
  shown: ActivityItem[];
  activity: ActivityState;
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
  rooms: SidebarRoom[];
  names: ActivityNames;
  openedId: number | null;
  selected: ReadonlySet<number>;
  onSelected: (selected: ReadonlySet<number>) => void;
  onOpen: (item: ActivityItem) => void;
  onLoadOlder: () => void;
  onMarkAllRead: () => void;
}

/**
 * The feed: Activity's title and tabs, the tools that select, mark, filter and search it, and its items,
 * newest first, under the day each came, with older ones loading as it's scrolled to its end.
 */
function Feed({ me, shown, activity, filter, onFilter, rooms, names, openedId, selected, onSelected, onOpen, onLoadOlder, onMarkAllRead }: FeedProps) {
  const { feed, mark } = activity;
  const [searching, setSearching] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (searching) search.current?.focus();
  }, [searching]);

  // Older items load as the end of the list comes into view.
  useEffect(() => {
    const element = end.current;
    if (!element || !feed.more) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && onLoadOlder());
    observer.observe(element);
    return () => observer.disconnect();
  }, [feed.more, onLoadOlder]);

  const allSelected = shown.length > 0 && shown.every((item) => selected.has(item.id));
  const selectAll = () => onSelected(allSelected ? new Set() : new Set(shown.map((item) => item.id)));
  const markSelected = (read: boolean) => {
    const ids = shown.filter((item) => selected.has(item.id)).map((item) => item.id);
    if (ids.length === 0) return read ? onMarkAllRead() : undefined;
    for (let start = 0; start < ids.length; start += 500) mark(ids.slice(start, start + 500), read);
    onSelected(new Set());
  };
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onSelected(next);
  };

  return (
    <section aria-labelledby="activity-title" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b px-4 pt-3.5 max-md:pt-1">
        <div className="flex items-center gap-2 max-md:sr-only">
          <h1 id="activity-title" className="text-[19px] leading-tight font-bold">
            Activity
          </h1>
          {feed.unread > 0 && <span className="sr-only">{feed.unread} unread</span>}
        </div>
        <nav aria-label="Activity" className="mt-2 flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              aria-pressed={filter.tab === tab}
              onClick={() => onFilter({ ...filter, tab })}
              className="relative flex shrink-0 items-center gap-1.5 px-2 pt-1 pb-2.5 text-sm font-semibold touch:min-h-11 touch:min-w-11 touch:justify-center text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:after:absolute aria-pressed:after:inset-x-1 aria-pressed:after:bottom-0 aria-pressed:after:h-0.5 aria-pressed:after:rounded-full aria-pressed:after:bg-foreground"
            >
              {label}
              {tab === "all" && feed.unread > 0 && <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />}
            </button>
          ))}
        </nav>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2">
        <input
          type="checkbox"
          aria-label={allSelected ? "Deselect all" : "Select all"}
          checked={allSelected}
          onChange={selectAll}
          // Fingers mark all read with the button beside it, as Slack's phones have no checkboxes.
          className="size-4 accent-foreground touch:hidden"
        />
        <button
          type="button"
          onClick={() => markSelected(true)}
          title={selected.size > 0 ? "Mark selected as read" : "Mark all as read"}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] font-semibold whitespace-nowrap hover:bg-hover touch:min-h-11"
        >
          <CheckCircle className="size-4" />
          {selected.size > 0 ? `Mark ${selected.size} read` : "Mark all read"}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => markSelected(false)}
            className="inline-flex min-h-8 items-center rounded-lg border px-2.5 text-[13px] font-semibold hover:bg-hover touch:min-h-11"
          >
            Mark unread
          </button>
        )}
        <label className="ml-auto flex items-center gap-2 text-[13px] font-semibold">
          Unreads
          <Switch checked={filter.unreadOnly} onCheckedChange={(unreadOnly) => onFilter({ ...filter, unreadOnly })} />
        </label>
        <FilterPopover filter={filter} onFilter={onFilter} rooms={rooms} me={me} />
        <button
          type="button"
          aria-label="Search activity"
          aria-pressed={searching}
          onClick={() => {
            if (searching) onFilter({ ...filter, query: "" });
            setSearching(!searching);
          }}
          className="grid size-8 shrink-0 place-items-center rounded-lg border hover:bg-hover aria-pressed:bg-hover touch:size-11"
        >
          <Search className="size-4" />
        </button>
      </div>
      {searching && (
        <div className="shrink-0 border-b px-4 py-2">
          <input
            ref={search}
            type="search"
            value={filter.query}
            onChange={(event) => onFilter({ ...filter, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              onFilter({ ...filter, query: "" });
              setSearching(false);
            }}
            placeholder="Search activity"
            aria-label="Search activity"
            className="w-full rounded-lg border bg-background px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:text-base"
          />
        </div>
      )}
      <ol aria-label="Activity items" aria-busy={!feed.loaded} className="min-h-0 flex-1 overflow-y-auto">
        {!feed.loaded ? (
          <li className="p-6 text-sm text-muted-foreground">Loading…</li>
        ) : shown.length === 0 ? (
          <li className="p-6 text-sm text-muted-foreground">{feed.items.length === 0 ? "Nothing’s happened yet. Mentions, DMs, thread replies and reactions will show up here." : "Nothing matches."}</li>
        ) : (
          withDays(shown).map((entry) =>
            entry.type === "day" ? (
              <li key={entry.key} className="px-4 pt-4 pb-1 text-[13px] font-bold">
                {entry.label}
              </li>
            ) : (
              <ActivityRow
                key={entry.item.id}
                item={entry.item}
                names={names}
                opened={entry.item.id === openedId}
                selected={selected.has(entry.item.id)}
                onSelect={() => toggle(entry.item.id)}
                onOpen={() => onOpen(entry.item)}
                onMark={(read) => mark([entry.item.id], read)}
              />
            ),
          )
        )}
        <div ref={end} aria-hidden="true" className="h-px" />
      </ol>
    </section>
  );
}

type FeedEntry = { type: "day"; key: string; label: string } | { type: "item"; item: ActivityItem };

/** The items, with the day each came over the first of that day's, as Slack's "Yesterday", but none over today's. */
export function withDays(items: ActivityItem[], now = new Date()): FeedEntry[] {
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const entries: FeedEntry[] = [];
  let last: string | null = null;
  for (const item of items) {
    const date = new Date(item.at);
    const day = date.toDateString();
    if (day !== last && day !== today) entries.push({ type: "day", key: `day-${day}`, label: day === yesterday.toDateString() ? "Yesterday" : dateLabel(date) });
    last = day;
    entries.push({ type: "item", item });
  }
  return entries;
}

/** What an item is, in a word or two, and the icon by its source. */
const KINDS: Record<ActivityItem["kind"], { icon: typeof AtSign; source: (where: string) => string }> = {
  mention: { icon: AtSign, source: (where) => `Mention in ${where}` },
  direct: { icon: ChatBubbleEmpty, source: () => "Direct message" },
  thread: { icon: MessageText, source: (where) => `Thread in ${where}` },
  reaction: { icon: Emoji, source: (where) => `Reaction in ${where}` },
  invitation: { icon: UserPlus, source: (where) => `Added you to ${where}` },
};

interface RowProps {
  item: ActivityItem;
  names: ActivityNames;
  opened: boolean;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMark: (read: boolean) => void;
}

/**
 * An item: who it's from, when, what it says and where it came from, bold with a dot while it's unread.
 * Pressing it opens its conversation beside the feed; its checkbox selects it, and its button marks it
 * read or unread, both showing as a pointer passes or it has focus.
 */
function ActivityRow({ item, names, opened, selected, onSelect, onOpen, onMark }: RowProps) {
  const people = useContext(PeopleContext);
  const { icon: Icon, source } = KINDS[item.kind];
  const where = names.roomNameOf(item.roomId);
  const author = names.nameOf(item.actorId);
  const date = new Date(item.at);
  const sameDay = date.toDateString() === new Date().toDateString();
  return (
    <li
      data-unread={!item.read || undefined}
      aria-current={opened || undefined}
      className={cn(
        "group relative flex gap-3 border-b px-4 py-3 hover:bg-hover aria-[current=true]:bg-hover",
        opened && "shadow-[inset_3px_0_0_var(--color-foreground)]",
      )}
    >
      <input
        type="checkbox"
        aria-label={`Select ${author}’s ${item.kind}`}
        checked={selected}
        onChange={onSelect}
        className={cn("mt-2 size-4 shrink-0 accent-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 touch:hidden", selected && "opacity-100")}
      />
      <UserAvatar user={{ id: item.actorId, name: author, avatarUrl: people.get(item.actorId)?.avatarUrl }} square className="mt-0.5 size-9 shrink-0" />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-[15px]", item.read ? "font-semibold" : "font-bold")}>{author}</span>
          <time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground">
            {sameDay ? timeLabel(date) : dateLabel(date)}
          </time>
        </span>
        <span className={cn("line-clamp-2 text-[15px] leading-snug wrap-anywhere", item.read ? "text-muted-foreground" : "text-foreground")}>
          {preview(item)}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{source(where)}</span>
        </span>
      </button>
      <span className="relative z-[1] flex shrink-0 flex-col items-end gap-1">
        {!item.read && <span aria-label="Unread" className="mt-2 size-2.5 rounded-full bg-foreground" />}
        <button
          type="button"
          onClick={() => onMark(!item.read)}
          title={item.read ? "Mark unread" : "Mark read"}
          aria-label={item.read ? `Mark unread: ${author}` : `Mark read: ${author}`}
          className="grid size-7 place-items-center rounded-md border bg-background opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-hover touch:size-11 touch:opacity-100"
        >
          {item.read ? <span className="size-2.5 rounded-full border-2 border-foreground" /> : <CheckCircle className="size-4" />}
        </button>
      </span>
    </li>
  );
}

/** What an item's row says it is. */
function preview(item: ActivityItem): string {
  if (item.kind === "invitation") return "Added you to a private room";
  if (item.kind === "reaction") return `Reacted ${item.content ?? ""} to “${item.preview}”`;
  return item.preview || "(a file)";
}

interface FilterProps {
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
  rooms: SidebarRoom[];
  me: Me;
}

/** Filter by: the kinds of item to show, apps' among them, and one room alone. */
function FilterPopover({ filter, onFilter, rooms, me }: FilterProps) {
  const nameOf = useNameOf();
  const count = filterCount(filter);
  const toggle = (kind: ActivityFilterKind) => {
    const kinds = new Set(filter.kinds);
    if (!kinds.delete(kind)) kinds.add(kind);
    onFilter({ ...filter, kinds });
  };
  const listed = rooms.filter((room) => room.involvement !== "invisible");
  return (
    <Popover>
      <PopoverTrigger
        aria-label={count > 0 ? `Filter, ${count} on` : "Filter"}
        className={cn("relative grid size-8 shrink-0 place-items-center rounded-lg border hover:bg-hover touch:size-11", count > 0 && "bg-hover")}
      >
        <FilterList className="size-4" />
        {count > 0 && (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 grid size-4 place-items-center rounded-full bg-foreground text-[10px] font-bold text-background">
            {count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h2 className="text-sm font-bold">Filter by</h2>
          {count > 0 && (
            <button type="button" onClick={() => onFilter({ ...filter, kinds: new Set(), roomId: null })} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <Xmark className="size-3.5" />
              Clear
            </button>
          )}
        </div>
        <fieldset className="flex flex-col py-1">
          <legend className="sr-only">Kinds of activity</legend>
          {FILTERS.map(({ kind, label }) => (
            <label key={kind} className="flex min-h-9 cursor-pointer items-center gap-2.5 px-3 text-sm hover:bg-hover touch:min-h-11">
              <input type="checkbox" checked={filter.kinds.has(kind)} onChange={() => toggle(kind)} className="size-4 accent-foreground" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="border-t px-3 py-2.5">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
            Specific room
            <select
              value={filter.roomId ?? ""}
              onChange={(event) => onFilter({ ...filter, roomId: event.target.value || null })}
              className="rounded-md border bg-background px-2 py-1.5 text-sm font-normal text-foreground max-md:text-base"
            >
              <option value="">Any room</option>
              {listed.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.kind === "direct" ? roomName(room, me.id, nameOf) : `#${room.name}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}
