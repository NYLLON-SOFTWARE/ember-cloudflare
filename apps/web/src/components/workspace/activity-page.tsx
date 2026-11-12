import { useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { savedPath, workspacePageOf, type ActivityItem, type Me, type RoomId, type SidebarRoom, type UserId } from "@ember/protocol";
import {
  ArrowLeft,
  AtSign,
  ChatBubbleEmpty,
  CheckCircle,
  Clock,
  Emoji,
  EyeClosed,
  FilterList,
  MessageText,
  MoreHoriz,
  Search,
  UserPlus,
  Xmark,
} from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { activityPath, navigate, personPath, returnTo } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import type { ActivityState } from "@/hooks/use-activity";
import { ALL_ACTIVITY, filterCount, shows, type ActivityFilter, type ActivityFilterKind, type ActivityNames, type ActivityTab } from "@/lib/activity-feed";
import { roomName } from "@/lib/directs";
import { dateLabel, timeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";
import { ProfilePanel } from "./profile-panel";
import { useProfilePane } from "./profile-pane";
import type { RoomPanes } from "./room-view";
import { ONE_PANE, SplitPanes, type Pane, type PaneStack } from "./split-panes";
import { AvatarLink } from "./user-avatar";

// Activity, as Slack's is: a feed of what's happened to you beside the conversation an item opens, with
// its thread, or the profile of someone in it, in a third pane, each pane as wide as you drag it.

/**
 * The conversation open beside the feed, as the address says: its room, around a message, with a thread
 * open, at a reply in it when an item that's a reply opened it.
 */
export interface ActivityPlace {
  roomId: RoomId;
  messageId?: string;
  threadId?: string;
  replyId?: string;
}

interface Props {
  me: Me;
  /** The conversation the address opens beside the feed, or null. */
  place: ActivityPlace | null;
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
  { kind: "reminder", label: "Reminders" },
  { kind: "apps", label: "Apps" },
];

/** Where an item opens its conversation: at its message, and a reply in its thread, at the reply. */
export function placeOf(item: ActivityItem): ActivityPlace {
  const place: ActivityPlace = { roomId: item.roomId };
  if (item.messageId === null) return place;
  if (item.parentId !== null) return { ...place, threadId: item.parentId, replyId: item.messageId };
  return { ...place, messageId: item.messageId };
}

export function ActivityPage({ me, place, rooms, activity, renderRoom, onPaneStack }: Props) {
  useTitle("Activity");
  const { feed, loadOlder, mark, markAllRead } = activity;
  const profile = useProfilePane();
  const [filter, setFilter] = useState<ActivityFilter>(ALL_ACTIVITY);
  const [threadPane, setThreadPane] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const [hiddenPanes, setHiddenPanes] = useState(0);
  const names = useActivityNames(rooms, me);
  const shown = useMemo(() => feed.items.filter((item) => shows(filter, item, names)), [feed.items, filter, names]);
  const roomOpen = place !== null && rooms.some((room) => room.id === place.roomId);
  const conversation = place !== null && roomOpen;

  // The panes open are the address's, so a reload keeps them, and Back closes the one opened last.
  const open = (item: ActivityItem) => {
    // A reminder opens its to-do, wherever its message is.
    if (item.kind === "reminder") {
      if (!item.read) mark([item.id], true);
      return navigate(savedPath("todo", item.content ?? undefined));
    }
    navigate(activityPath(placeOf(item)));
    if (!item.read) mark([item.id], true);
  };
  // Closing a pane goes back to where it opened from, as Back does, so that Back never opens it again,
  // or where nothing opened it, as after a reload, takes its parent's place in the history.
  const closeThread = () => {
    if (place) returnTo(activityPath({ roomId: place.roomId, messageId: place.messageId }));
  };
  const closeConversation = () => returnTo(activityPath(null));

  // A thread opened from the conversation shown opens in the pane beside it, as Slack's do, rather than
  // going to the room's page; anything else the conversation links to goes there.
  const openThreadForLink = (event: MouseEvent) => {
    if (!place || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest("a[href]");
    if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) return;
    const target = workspacePageOf(link.pathname);
    if (target?.page !== "room" || target.roomId !== place.roomId || target.threadId === undefined) return;
    event.preventDefault();
    navigate(activityPath({ ...place, threadId: target.threadId, replyId: target.replyId }));
  };

  const side = profile?.userId ? "profile" : place?.threadId !== undefined ? "thread" : null;
  // On phones, the feed shows alone until an item opens, rather than the bubble that waits for one.
  const phone = useMediaQuery(ONE_PANE);
  // Filter, search and Mark all read, in the page's header: the feed's own beside the panes, and the
  // phone's over it.
  const tools = (
    <FeedTools
      filter={filter}
      onFilter={setFilter}
      rooms={rooms}
      me={me}
      searching={searching}
      onSearching={setSearching}
      anyUnread={feed.unread > 0}
      onMarkAllRead={markAllRead}
    />
  );
  const panes: Pane[] = [
    {
      id: "feed",
      label: "Resize activity",
      minWidth: 320,
      defaultShare: side ? 0.3 : 0.42,
      content: (
        <Feed
          shown={shown}
          activity={activity}
          filter={filter}
          onFilter={setFilter}
          tools={phone ? null : tools}
          searching={searching}
          onSearching={setSearching}
          names={names}
          openedId={place && (shown.find((item) => opens(item, place))?.id ?? null)}
          onOpen={open}
          onLoadOlder={loadOlder}
        />
      ),
    },
    {
      id: "conversation",
      label: "Resize activity",
      onClose: place ? closeConversation : undefined,
      minWidth: 380,
      defaultShare: side ? 0.4 : 0.58,
      content:
        place && roomOpen ? (
          <div className="flex h-full min-h-0 flex-col" onClickCapture={openThreadForLink}>
            {/* Where the row's too narrow for the feed beside it; phones' back stack is the mobile layout's. */}
            {hiddenPanes > 0 && !phone && <BackToActivity onClick={closeConversation} />}
            <div className="min-h-0 flex-1">{renderRoom(place, { thread: threadPane, onCloseThread: closeThread })}</div>
          </div>
        ) : place ? (
          <Unavailable />
        ) : (
          <NothingOpen />
        ),
    },
  ];
  // With nothing open, the feed shows alone on phones, and beside a profile anywhere, with no empty pane between.
  if (!place && (phone || side === "profile")) panes.pop();
  if (side === "thread" && roomOpen)
    panes.push({ id: "thread", label: "Resize thread", minWidth: 300, defaultShare: 0.3, sizedBySeparator: true, onClose: closeThread, content: <div ref={setThreadPane} className="h-full min-h-0" /> });
  if (side === "profile" && profile)
    panes.push({ id: "profile", label: "Resize profile", minWidth: 300, defaultShare: 0.3, sizedBySeparator: true, onClose: profile.close, content: <ProfilePanel userId={profile.userId!} me={me} pane={profile} placement="pane" /> });

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
          {phone && <div className="ml-auto flex items-center">{tools}</div>}
        </PageHeader>
      </div>
      <SplitPanes
        layoutKey="activity"
        panes={panes}
        onCollapsed={setHiddenPanes}
        onLayout={onPaneStack}
        // On a phone on its side, clear of the notch.
        className={cn(
          "col-start-2 col-end-[-1] row-span-2 row-start-1 bg-background max-md:col-start-1 max-md:pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]",
          !conversation && "max-md:row-span-1 max-md:row-start-2",
        )}
      />
    </>
  );
}

/** Whether `item` opened `place`, or opens it, a thread opened in its conversation since included. */
function opens(item: ActivityItem, place: ActivityPlace): boolean {
  const its = placeOf(item);
  if (its.roomId !== place.roomId) return false;
  if (its.replyId !== undefined) return its.threadId === place.threadId && its.replyId === place.replyId;
  return its.messageId === place.messageId && (its.messageId !== undefined || place.threadId === undefined);
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

/** What the conversation's pane says for an address naming a room you aren't in, or no room at all. */
function Unavailable() {
  return (
    <MainContent className="grid h-full place-content-center border-l bg-background p-6 text-sm text-muted-foreground">
      <p>You can’t open this conversation.</p>
    </MainContent>
  );
}

/** Where the conversation goes until an item opens one: the page's content, quiet. */
function NothingOpen() {
  return <MainContent className="h-full border-l bg-background" />;
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
  shown: ActivityItem[];
  activity: ActivityState;
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
  /** Filter, search and Mark all read, beside the title, unless the phone's header has them. */
  tools: ReactNode;
  searching: boolean;
  onSearching: (searching: boolean) => void;
  names: ActivityNames;
  openedId: number | null;
  onOpen: (item: ActivityItem) => void;
  onLoadOlder: () => void;
}

/**
 * The feed: Activity's title and tools, its tabs and Unreads, and its items, newest first, under the day
 * each came, with older ones loading as it's scrolled to its end.
 */
function Feed({ shown, activity, filter, onFilter, tools, searching, onSearching, names, openedId, onOpen, onLoadOlder }: FeedProps) {
  const { feed, mark } = activity;
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

  return (
    <section aria-labelledby="activity-title" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="shrink-0 border-b px-4 pt-3 max-md:pt-1">
        <div className="flex min-h-8 items-center gap-1 max-md:sr-only">
          <h1 id="activity-title" className="mr-auto text-[19px] leading-tight font-bold">
            Activity
          </h1>
          {feed.unread > 0 && <span className="sr-only">{feed.unread} unread</span>}
          {tools}
        </div>
        <nav aria-label="Activity" className="mt-1.5 flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {TABS.map(({ tab, label }) => (
            <button
              key={tab}
              type="button"
              aria-pressed={filter.tab === tab}
              onClick={() => onFilter({ ...filter, tab })}
              className="relative flex shrink-0 items-center px-2 pt-1 pb-2.5 text-sm font-semibold touch:min-h-11 touch:min-w-11 touch:justify-center text-muted-foreground hover:text-foreground aria-pressed:text-foreground aria-pressed:after:absolute aria-pressed:after:inset-x-1 aria-pressed:after:bottom-0 aria-pressed:after:h-0.5 aria-pressed:after:rounded-full aria-pressed:after:bg-foreground"
            >
              {label}
            </button>
          ))}
          {/* A chip that says itself whether it's on, filled while it is. */}
          <button
            type="button"
            aria-pressed={filter.unreadOnly}
            onClick={() => onFilter({ ...filter, unreadOnly: !filter.unreadOnly })}
            className="mb-1.5 ml-auto shrink-0 rounded-full border px-2.5 py-0.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background touch:min-h-11 touch:px-3.5"
          >
            Unreads
          </button>
        </nav>
      </header>
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
              onSearching(false);
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
          <li className="p-6 text-sm text-muted-foreground">{emptyFeedLine(feed.items.length > 0, filter)}</li>
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

/** An icon button in the page's header, with nothing around it until a pointer's over it. */
const TOOL = "relative grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground aria-pressed:bg-hover aria-pressed:text-foreground data-[state=open]:bg-hover touch:size-11";

interface ToolsProps {
  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
  rooms: SidebarRoom[];
  me: Me;
  searching: boolean;
  onSearching: (searching: boolean) => void;
  anyUnread: boolean;
  onMarkAllRead: () => void;
}

/** Filter by, Search, and ⋯ with Mark all read. */
function FeedTools({ filter, onFilter, rooms, me, searching, onSearching, anyUnread, onMarkAllRead }: ToolsProps) {
  return (
    <>
      <FilterPopover filter={filter} onFilter={onFilter} rooms={rooms} me={me} />
      <button
        type="button"
        aria-label="Search activity"
        aria-pressed={searching}
        onClick={() => {
          if (searching) onFilter({ ...filter, query: "" });
          onSearching(!searching);
        }}
        className={TOOL}
      >
        <Search className="size-[18px]" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="More activity actions" className={TOOL}>
          <MoreHoriz className="size-[18px]" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!anyUnread} onSelect={onMarkAllRead}>
            <CheckCircle />
            Mark all read
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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

/** What the feed says with nothing to show: one line, saying why. */
function emptyFeedLine(anyItems: boolean, filter: ActivityFilter): string {
  if (!anyItems) return "No activity yet.";
  const onlyUnreads = filter.unreadOnly && filter.tab === "all" && filter.kinds.size === 0 && filter.roomId === null && filter.query.trim() === "";
  return onlyUnreads ? "You’re all caught up." : "Nothing matches.";
}

/** What each kind of item is, for screen readers, and its icon, by the conversation it's from. */
const KINDS: Record<ActivityItem["kind"], { icon: typeof AtSign; word: string }> = {
  mention: { icon: AtSign, word: "Mention" },
  direct: { icon: ChatBubbleEmpty, word: "Direct message" },
  thread: { icon: MessageText, word: "Thread reply" },
  reaction: { icon: Emoji, word: "Reaction" },
  invitation: { icon: UserPlus, word: "Invitation" },
  reminder: { icon: Clock, word: "Reminder" },
};

interface RowProps {
  item: ActivityItem;
  names: ActivityNames;
  opened: boolean;
  onOpen: () => void;
  onMark: (read: boolean) => void;
}

/** How long a finger holds an item for its menu, and how far it can stray meanwhile. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

/**
 * An item: who it's from, when, what it says and where it came from, on a brighter surface with its
 * author in bold while it's unread. Pressing it opens its conversation beside the feed, which reads it.
 * Its one button, marking it read or unread, shows only as a pointer passes or it has focus; U does the
 * same, and its menu, which a right click, the menu key or a long press opens, has it too.
 */
function ActivityRow({ item, names, opened, onOpen, onMark }: RowProps) {
  const people = useContext(PeopleContext);
  const { icon: Icon, word } = KINDS[item.kind];
  const where = names.roomNameOf(item.roomId);
  // A reminder is your own, so it names itself rather than you.
  const reminder = item.kind === "reminder";
  const author = reminder ? "Reminder" : names.nameOf(item.actorId);
  const actor = { id: item.actorId, name: author, avatarUrl: people.get(item.actorId)?.avatarUrl };
  const date = new Date(item.at);
  const sameDay = date.toDateString() === new Date().toDateString();
  const markLabel = item.read ? "Mark unread" : "Mark read";
  const toggle = () => onMark(!item.read);

  // The menu opens where it was asked for, at the pointer, or by the item's start for the menu key.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const pressed = useRef(false);
  const openMenu = (event: MouseEvent<HTMLLIElement>) => {
    event.preventDefault();
    const box = event.currentTarget.getBoundingClientRect();
    const byKey = event.clientX === 0 && event.clientY === 0;
    setMenuAt(byKey ? { x: 48, y: 16 } : { x: event.clientX - box.left, y: event.clientY - box.top });
  };
  const pointerDown = (event: PointerEvent<HTMLLIElement>) => {
    if (event.pointerType !== "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = { x: event.clientX - box.left, y: event.clientY - box.top };
    pressed.current = false;
    press.current = {
      ...at,
      timer: setTimeout(() => {
        pressed.current = true;
        setMenuAt(at);
      }, LONG_PRESS_MS),
    };
  };
  const pointerMove = (event: PointerEvent<HTMLLIElement>) => {
    const started = press.current;
    if (!started) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (Math.hypot(event.clientX - box.left - started.x, event.clientY - box.top - started.y) > LONG_PRESS_SLOP_PX) endPress();
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => endPress, []);
  const keyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== "u" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    toggle();
  };

  return (
    <li
      data-unread={!item.read || undefined}
      aria-current={opened || undefined}
      onContextMenu={openMenu}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      // A long press opened the menu, which the press's click mustn't open the item behind.
      onClickCapture={(event) => {
        if (!pressed.current) return;
        pressed.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      className={cn(
        "group relative flex gap-3 border-b px-4 py-3 [-webkit-touch-callout:none] hover:bg-hover aria-[current=true]:bg-hover touch:select-none",
        !item.read && "bg-activity-unread",
        opened && "shadow-[inset_3px_0_0_var(--color-foreground)]",
      )}
    >
      {/* The avatar and name open the author's profile, as a message's do, over the button that covers the row. */}
      {reminder ? (
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
          <Clock className="size-5" />
        </span>
      ) : (
        <AvatarLink user={actor} square reach="none" className="z-[1] mt-0.5 size-9" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 pr-8 touch:pr-0">
          <PageLink href={personPath(item.actorId)} className={cn("relative z-[1] truncate text-[15px] hover:underline", item.read ? "font-medium" : "font-bold")}>
            {author}
          </PageLink>
          <time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground">
            {sameDay ? timeLabel(date) : dateLabel(date)}
          </time>
        </div>
        <button
          type="button"
          onClick={onOpen}
          onKeyDown={keyDown}
          aria-keyshortcuts="U"
          // Who it's from, whether it's unread, what it says and where, as separate words, which the
          // lines it shows them in wouldn't keep apart.
          aria-label={`${author}${item.read ? "" : ", unread"}: ${preview(item)}, ${word} in ${where}`}
          className="block w-full text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        >
          <span className={cn("line-clamp-2 text-[15px] leading-snug wrap-anywhere", item.read ? "text-muted-foreground" : "text-foreground")}>{preview(item)}</span>
          {/* The conversation it's from, which a DM with its author alone doesn't need named again. */}
          {where !== author && (
            <span className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{where}</span>
            </span>
          )}
        </button>
      </div>
      <button
        type="button"
        onClick={toggle}
        title={markLabel}
        aria-label={`${markLabel}: ${author}`}
        className="absolute top-2.5 right-3 z-[1] grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-background hover:text-foreground touch:hidden"
      >
        {item.read ? <EyeClosed className="size-4" /> : <CheckCircle className="size-4" />}
      </button>
      <DropdownMenu open={menuAt !== null} onOpenChange={(open) => !open && setMenuAt(null)}>
        <DropdownMenuTrigger aria-hidden tabIndex={-1} className="pointer-events-none absolute size-px" style={menuAt ? { left: menuAt.x, top: menuAt.y } : undefined} />
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={onOpen}>
            <Icon />
            Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={toggle}>
            {item.read ? <EyeClosed /> : <CheckCircle />}
            {markLabel}
            <kbd className="ml-auto pl-4 text-xs text-muted-foreground">U</kbd>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** What an item's row says it is. */
function preview(item: ActivityItem): string {
  if (item.kind === "invitation") return "Added you";
  if (item.kind === "reminder") return item.preview || "A to-do";
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
        className={cn(TOOL, count > 0 && "text-foreground")}
      >
        <FilterList className="size-[18px]" />
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
