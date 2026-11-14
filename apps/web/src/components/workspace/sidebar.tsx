import { useContext, useId, useMemo, useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import type { Favorites, LiveHuddle, Me, RoomId, SidebarRoom, UserId } from "@ember/protocol";
import { Bookmark, EditPencil, Group, Headset, Lock, MultiBubble, NavArrowDown, type IconoirIconProps } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { DRAFTS_PATH, PEOPLE_PATH, roomPath, SAVED_PATH, THREADS_PATH } from "@/hooks/use-route";
import { useStarOrder } from "@/hooks/use-star-order";
import { apart, inSidebarOrder, markedUnread, type SharedSidebarRoom } from "@/lib/room-list";
import { roomDisplayName, roomTree } from "@/lib/sub-rooms";
import { isFolded, rememberFolded, type SidebarSection } from "@/lib/sidebar-sections";
import { unreadBadge } from "@/lib/unread-badge";
import { cn } from "@/lib/utils";
import { RoomTreeRow, useCollapsedRooms, type TreeRowOptions } from "./room-tree-row";
import { PeopleContext } from "@/hooks/use-directory";
import { inItsHuddle } from "@/lib/huddle-people";
import { UserAvatar } from "./user-avatar";

/** A row of the list, a link's or a room's. The selected one is filled, and only an unread one is bold. */
const ROW =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11 hover:bg-hover aria-[current=page]:bg-hover";

/** The Home sidebar's own pages, which its links at the top open. */
export type SidebarPage = "threads" | "drafts" | "saved" | "people";

/** The links at the top of the list, in order, after Slack's. */
const LINKS: Array<{ page: SidebarPage; label: string; href: string; Icon: ComponentType<IconoirIconProps> }> = [
  { page: "threads", label: "Threads", href: THREADS_PATH, Icon: MultiBubble },
  { page: "drafts", label: "Drafts & sent", href: DRAFTS_PATH, Icon: EditPencil },
  { page: "saved", label: "Saved", href: SAVED_PATH, Icon: Bookmark },
  { page: "people", label: "People", href: PEOPLE_PATH, Icon: Group },
];

/** How many of the people in a huddle its room's row shows the faces of. */
const MAX_HUDDLE_FACES = 2;

interface Props {
  /** The workspace's name, which heads the list. */
  workspaceName: string;
  /** Who the list is for, whom a huddle's words call you. */
  meId: UserId;
  /** Someone's rooms and DMs, in any order, of which the list shows the rooms. */
  rooms: SidebarRoom[];
  /** Whether their list has come, before which nothing says there's nothing in it. */
  loaded: boolean;
  /** The rooms they've starred, which Starred lists, and which can be moved among themselves. */
  favorites: Favorites;
  /** The rooms the workspace's shared order ranks, which Rooms lists first, in its order. */
  sharedOrder: RoomId[];
  /** The huddles going on in their rooms, by room, whose rows say who's in them. */
  huddles: Record<RoomId, LiveHuddle>;
  currentRoomId: string | null;
  /** Which of the links' pages is shown, if one is. */
  currentPage: SidebarPage | null;
  /** How many drafts there are in this browser, which Drafts & sent counts (`useDraftCount`). */
  draftCount: number;
  /** Whether Activity is on, which shows only the rows marked unread. */
  unreadOnly: boolean;
  onSelect: (roomId: string) => void;
  /** Called with this person's stars as the server answers them, once a new order for them is saved. */
  onStarred: (favorites: Favorites) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * Home's list, under the workspace name: links to Threads, Drafts & sent and People, then the rooms, never DMs, which the
 * DMs page lists. The starred rooms come under Starred, in the order they were starred, then the rest
 * under Rooms, the ones the shared order ranks first, in its order, then by name. Each section folds
 * under its heading, as this browser remembers, leaving the room shown and the unread ones. A starred
 * room's row has no grip, as the project's owner chose: held, it can be dragged among the other starred
 * rows, or moved with Alt and an arrow (`useStarOrder`). A room marked unread is bold with a dot at the
 * end of its row. With Activity on, only those rows show, and with none it says everything's read; with
 * it off and nothing to list, it says it found nothing.
 */
export function Sidebar({ workspaceName, meId, rooms, loaded, favorites, sharedOrder, huddles, currentRoomId, currentPage, draftCount, unreadOnly, onSelect, onStarred, onSessionChanged }: Props) {
  const { shared } = useMemo(() => apart(unreadOnly ? rooms.filter((room) => markedUnread(room, currentRoomId)) : rooms), [rooms, unreadOnly, currentRoomId]);
  const shown = useMemo(() => new Set(shared.map((room) => room.id)), [shared]);
  const nameOf = (roomId: RoomId) => {
    const room = rooms.find((r) => r.id === roomId);
    return room && room.kind !== "direct" ? room.name : "";
  };
  const { order, moving, status, listRef, scrollerRef, listProps } = useStarOrder({ favorites, shown, nameOf, onSaved: onStarred, onSessionChanged });
  const starred = useMemo(() => new Set(order), [order]);
  const listed = useMemo(() => inSidebarOrder(shared, order, sharedOrder), [shared, order, sharedOrder]);
  const [folded, setFolded] = useState(() => ({ starred: isFolded("starred"), rooms: isFolded("rooms") }));
  const toggle = (section: SidebarSection) => {
    rememberFolded(section, !folded[section]);
    setFolded((folded) => ({ ...folded, [section]: !folded[section] }));
  };
  // A folded section still shows the room the tab shows and the unread ones, as Slack's does.
  const shownIn = (section: SidebarSection, sectionRooms: SharedSidebarRoom[]) =>
    folded[section] ? sectionRooms.filter((room) => room.id === currentRoomId || markedUnread(room, currentRoomId)) : sectionRooms;
  const starredRooms = shownIn("starred", listed.filter((room) => starred.has(room.id)));
  const otherRooms = shownIn("rooms", listed.filter((room) => !starred.has(room.id)));
  // Starred rooms keep their place among the stars; the rest nest their sub-rooms under their parents.
  const tree = roomTree(otherRooms);
  const { collapsed, toggle: toggleSubRooms } = useCollapsedRooms();
  const isUnread = (room: SharedSidebarRoom) => markedUnread(room, currentRoomId);
  const hasStarred = listed.some((room) => starred.has(room.id));
  const empty = loaded && listed.length === 0;
  const helpId = useId();
  const unreadId = useId();
  // A row followed in place shows its room here, and one opened elsewhere, as in a new tab, leaves this page be.
  const select = (event: MouseEvent, roomId: RoomId) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(roomId);
  };
  // A room's row, which a parent's and its sub-rooms' are too (`RoomTreeRow`).
  const row = (room: SharedSidebarRoom, { label, unread, count, mentioned, className }: TreeRowOptions) => (
    <RoomRow
      key={room.id}
      room={room}
      label={label}
      className={className}
      current={room.id === currentRoomId}
      unread={unread}
      count={count}
      mentioned={mentioned}
      starred={starred.has(room.id)}
      moving={room.id === moving}
      huddle={huddles[room.id]}
      meId={meId}
      unreadId={unreadId}
      helpId={helpId}
      onClick={(event) => select(event, room.id)}
    />
  );
  return (
    <div ref={scrollerRef} className="flex h-full flex-col gap-3.5 overflow-y-auto overflow-x-hidden bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] narrow:px-2 max-md:gap-4 max-md:px-2.5 max-md:pt-4 max-md:pb-[max(16px,env(safe-area-inset-bottom))]">
      {/* The workspace's name alone, without its tagline, which says nothing the list needs. At 900px and
          below the drawer's close button sits at the end of its row. A long name wraps rather than running
          under the sidebar's edge. */}
      <h2 className="flex min-h-7 items-center gap-2 px-[9px] text-[17px] leading-6 font-[650] wrap-anywhere max-md:pr-10">{workspaceName}</h2>

      <nav aria-label="Home" className="flex flex-col gap-[3px]">
        {LINKS.map(({ page, label, href, Icon }) => {
          // Drafts & sent counts the drafts, as Slack's does.
          const count = page === "drafts" ? draftCount : 0;
          return (
            <PageLink
              key={page}
              href={href}
              aria-current={currentPage === page ? "page" : undefined}
              aria-description={count > 0 ? `${count} ${count === 1 ? "draft" : "drafts"}` : undefined}
              className={ROW}
            >
              <Icon className="size-[18px] shrink-0 text-muted-foreground" />
              <span className="truncate">{label}</span>
              {count > 0 && (
                <span aria-hidden="true" className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                  {count}
                </span>
              )}
            </PageLink>
          );
        })}
      </nav>

      <p id={helpId} className="sr-only">
        Hold a starred room to drag it, or press Alt and the up or down arrow to reorder your favorites. Other rooms follow the workspace order.
      </p>
      <span id={unreadId} hidden>
        Unread
      </span>
      {hasStarred && (
        <Section title="Starred" folded={folded.starred} onToggle={() => toggle("starred")}>
          <div ref={listRef} {...listProps} className={cn("flex flex-col gap-[3px]", moving && "select-none")}>
            {starredRooms.map((room) => row(room, { label: roomDisplayName(room, rooms), unread: isUnread(room) }))}
          </div>
        </Section>
      )}
      <Section title="Rooms" folded={folded.rooms} onToggle={() => toggle("rooms")}>
        <div className="flex flex-col gap-[3px]">
          {tree.map((branch) => (
            <RoomTreeRow
              key={branch.room.id}
              branch={branch}
              label={roomDisplayName(branch.room, rooms)}
              row={row}
              isUnread={isUnread}
              currentRoomId={currentRoomId}
              collapsed={collapsed.has(branch.room.id)}
              onToggle={toggleSubRooms}
            />
          ))}
        </div>
        {/* Moves are told to screen readers, and a save that fails is shown. */}
        <p role="status" className={status?.error ? "mx-[9px] my-1 text-xs leading-normal text-negative wrap-anywhere" : "sr-only"}>
          {status?.message}
        </p>
      </Section>
      {empty && <p className="px-[9px] text-[13px] text-muted-foreground">{unreadOnly ? "You’re all caught up. No unread rooms." : "No rooms found."}</p>}
    </div>
  );
}

interface SectionProps {
  title: string;
  folded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * A section of the list, Starred or Rooms, under a heading that folds it, small and muted, with a caret
 * before it that turns to point at the heading while it's folded, as Slack's sections fold.
 */
function Section({ title, folded, onToggle, children }: SectionProps) {
  const headingId = useId();
  const contentId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <h3 id={headingId} className="mb-[5px]">
        <button
          type="button"
          aria-expanded={!folded}
          aria-controls={contentId}
          onClick={onToggle}
          className="flex min-h-6 cursor-pointer items-center gap-1.5 rounded-md px-[9px] text-xs font-medium text-muted-foreground hover:text-foreground touch:min-h-11"
        >
          <NavArrowDown aria-hidden="true" className={cn("size-3 shrink-0 transition-transform duration-150", folded && "-rotate-90")} />
          {title}
        </button>
      </h3>
      <div id={contentId} className="flex flex-col">
        {children}
      </div>
    </section>
  );
}

interface RoomRowProps {
  room: SharedSidebarRoom;
  /** Its name as the row shows it, its own by default: "Strata – Sales" for a sub-room listed apart from its parent. */
  label?: string;
  /** Classes the row adds, as a sub-room's indent. */
  className?: string;
  /** Whether it's the room the tab shows. */
  current: boolean;
  /** Whether it's marked unread, which makes it bold, with a dot, or its count. */
  unread: boolean;
  /**
   * How many unread messages its pill counts, up to "9+", in place of its dot, or none for the dot alone:
   * its own count by default, and a folded parent's its sub-rooms' too.
   */
  count?: number;
  /**
   * Whether a message it counts mentions you, which draws its pill strong, in ink, as Slack sets mentions
   * apart, rather than muted: its own by default, and a folded parent's its sub-rooms' too.
   */
  mentioned?: boolean;
  /** Whether it's starred, which ends it with a star and lets it be held and dragged among the stars. */
  starred: boolean;
  /** Whether it's the starred row being dragged. */
  moving: boolean;
  /** The huddle going on in it, if one is, which ends its row with who's in it. */
  huddle?: LiveHuddle;
  /** Who the list is for, whom the huddle's words call you. */
  meId: UserId;
  /** The elements saying a row is unread, and how the stars are reordered, which describe it to screen readers. */
  unreadId: string;
  helpId: string;
  onClick: (event: MouseEvent) => void;
}

/**
 * A room's row, in Starred or Rooms: its icon and name, then, when it's unread, how many messages are, as
 * Slack counts them, up to "9+", or a dot where none are counted. A room followed not at all is grey, and
 * shows only what mentions you, as Slack's muted channels do. It carries `data-room-id`, by which
 * `useStarOrder` drags it.
 */
export function RoomRow({ room, label = room.name, className, current, unread, count = room.unreadCount ?? 0, mentioned = room.unreadMentioned ?? false, starred, moving, huddle, meId, unreadId, helpId, onClick }: RoomRowProps) {
  // The words for who's in the room's huddle, which come with its mark.
  const huddleId = useId();
  const countId = useId();
  const muted = room.involvement === "nothing";
  const showsUnread = unread && (!muted || count > 0);
  const counted = showsUnread && count > 0;
  return (
    <a
      data-room-id={room.id}
      href={roomPath(room.id)}
      draggable={false}
      aria-current={current ? "page" : undefined}
      // Every row says how the stars are reordered, and a marked one says it's unread, and how many, which
      // the eye sees by its weight and its dot or count.
      aria-describedby={[huddle && huddleId, counted ? `${countId} ${helpId}` : showsUnread ? `${unreadId} ${helpId}` : helpId].filter(Boolean).join(" ")}
      aria-keyshortcuts={starred ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
      onClick={onClick}
      className={cn(
        ROW,
        className,
        "[-webkit-touch-callout:none]",
        showsUnread && "font-bold",
        muted && !showsUnread && "text-muted-foreground",
        starred && "cursor-grab",
        moving && "relative z-[1] cursor-grabbing bg-background! shadow-[0_4px_14px_var(--color-drag-shadow)] outline outline-muted-foreground",
      )}
    >
      {/* A private room without an icon of its own has a lock where an open one has `#`, as Slack's have. */}
      {room.icon === null && room.kind === "closed" ? (
        <Lock aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />
      ) : (
        <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
      )}
      <span className="truncate">{label}</span>
      {huddle && <HuddleMark huddle={huddle} meId={meId} wordsId={huddleId} className="ml-auto" />}
      {/* Starred says a room's starred, so its row has no star of its own, as Slack's have none. */}
      {counted ? (
        <>
          <span id={countId} hidden>
            {unreadBadge(count)} unread{mentioned ? ", mentioning you" : ""}
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "ml-auto inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-semibold",
              mentioned ? "bg-foreground text-background" : "bg-muted-foreground/25 text-foreground",
            )}
          >
            {unreadBadge(count)}
          </span>
        </>
      ) : (
        // Muted, as ink is for what mentions you.
        showsUnread && <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full bg-muted-foreground", !huddle && "ml-auto")} />
      )}
    </a>
  );
}

interface HuddleMarkProps {
  huddle: LiveHuddle;
  /** Who the sidebar is for, whom the words call you. */
  meId: UserId;
  /** The id of the words that say who's in the huddle, for the row to be described by. */
  wordsId: string;
  className?: string;
}

/**
 * What a room's row ends with while a huddle is going on in it, as Slack's does: the faces of the first
 * two people in it, the headphones and how many are in it, in green. Hovering it says who they are, in
 * the words that follow it, hidden, for the row to say to screen readers, which the mark is hidden from.
 */
function HuddleMark({ huddle, meId, wordsId, className }: HuddleMarkProps) {
  const people = useContext(PeopleContext);
  const faces = huddle.userIds.flatMap((userId) => people.get(userId) ?? []).slice(0, MAX_HUDDLE_FACES);
  const others = huddle.userIds.filter((userId) => userId !== meId);
  const who = inItsHuddle(others.flatMap((userId) => people.get(userId)?.name ?? []), others.length, others.length < huddle.userIds.length);
  return (
    <>
      <span aria-hidden="true" title={who} className={cn("flex shrink-0 items-center gap-1 text-xs font-medium text-positive", className)}>
        {/* Each ringed in the sidebar's color, which parts it from the face it overlaps. */}
        <span className="flex -space-x-1">
          {faces.map((person) => (
            <UserAvatar key={person.id} user={person} className="size-4 ring-1 ring-surface" />
          ))}
        </span>
        <Headset className="size-3.5" />
        <span className="tabular-nums">{huddle.userIds.length}</span>
      </span>
      <span id={wordsId} hidden>
        {who}
      </span>
    </>
  );
}

