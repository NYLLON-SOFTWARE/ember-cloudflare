import { useId, useMemo, type MouseEvent } from "react";
import type { Favorites, Me, RoomId, SidebarRoom, UserId } from "@ember/protocol";
import { MessagesAdd } from "@/components/icons/campfire";
import { GripVertical } from "@/components/icons/lucide";
import { RoomIcon } from "@/components/icons/room-icon";
import { useNameOf } from "@/hooks/use-directory";
import { NEW_DIRECT_PATH, roomPath } from "@/hooks/use-route";
import { useStarOrder } from "@/hooks/use-star-order";
import { membersShown } from "@/lib/directs";
import { apart, inSidebarOrder, markedUnread, type DirectSidebarRoom } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { opensNewDirect } from "./new-direct-dialog";
import { UserAvatar } from "./user-avatar";

/** A row of the list, a room's or a DM's, as ember-rust's `.room` and `.direct` are (zz-ember.css). */
const ROW =
  "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11 hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold";

/** How many avatars a group DM's row shows, as ember-rust's `_direct.html` takes them. */
const MAX_FACES = 4;

interface Props {
  /** The workspace's name, which heads the list, as ember-rust's users/sidebars/show.html has it. */
  workspaceName: string;
  /** Who the sidebar is for, whose DMs name the others in them. */
  meId: UserId;
  /** Someone's rooms and DMs, in any order. */
  rooms: SidebarRoom[];
  /** The rooms they've starred, whose rows come first, end with a star, and can be moved among themselves. */
  favorites: Favorites;
  currentRoomId: string | null;
  /** Whether Activity is on, which shows only the rows marked unread. */
  unreadOnly: boolean;
  onSelect: (roomId: string) => void;
  /** Opens New direct message, which the DMs heading's link does in place, from the link that opened it. */
  onNewDirect: (opener: HTMLElement) => void;
  /** Called with this person's stars as the server answers them, once a new order for them is saved. */
  onStarred: (favorites: Favorites) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * The conversation list: rooms, then DMs, under the workspace name. The starred rooms come first, then
 * the rest by name, and a starred room's row ends with a grip and a star, as channel_order_controller.js
 * marks it (`.mb-room-drag-handle`, `.mb-room-favorite-marker`): held, it can be dragged among the other
 * starred rows, or moved with Alt and an arrow (`useStarOrder`). A DM's row shows who else is in it, as
 * ember-rust's `_direct.html` does. A room or DM marked unread is bold with a dot at the end of its row,
 * as ember-rust's `.unread` and `.mb-room-status` are (zz-ember.css). With Activity on, only those rows
 * show, as shell.js's `filterRooms` leaves them, and with none it says everything's read. With no DMs,
 * a placeholder stands where ember-rust's suggestions would, which the filter hides too, so "No
 * conversations found.", for a sidebar with no rows at all, never shows yet.
 */
export function Sidebar({ workspaceName, meId, rooms, favorites, currentRoomId, unreadOnly, onSelect, onNewDirect, onStarred, onSessionChanged }: Props) {
  const { shared, directs } = useMemo(() => apart(unreadOnly ? rooms.filter((room) => markedUnread(room, currentRoomId)) : rooms), [rooms, unreadOnly, currentRoomId]);
  const shown = useMemo(() => new Set(shared.map((room) => room.id)), [shared]);
  const nameOf = (roomId: RoomId) => {
    const room = rooms.find((r) => r.id === roomId);
    return room && room.kind !== "direct" ? room.name : "";
  };
  const { order, moving, status, listRef, scrollerRef, listProps } = useStarOrder({ favorites, shown, nameOf, onSaved: onStarred, onSessionChanged });
  const listed = useMemo(() => inSidebarOrder(shared, order), [shared, order]);
  const starred = useMemo(() => new Set(order), [order]);
  const hasDirects = useMemo(() => rooms.some((room) => room.kind === "direct"), [rooms]);
  const helpId = useId();
  const unreadId = useId();
  // A row followed in place shows its room here, and one opened elsewhere, as in a new tab, leaves this page be.
  const select = (event: MouseEvent, roomId: RoomId) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(roomId);
  };
  return (
    <div ref={scrollerRef} className="flex h-full flex-col gap-3.5 overflow-y-auto overflow-x-hidden bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] narrow:px-2 max-md:gap-4 max-md:px-2.5 max-md:pt-4 max-md:pb-[max(16px,env(safe-area-inset-bottom))]">
      {/* At 900px and below the drawer's close button sits at the end of this row. A long name wraps where
          ember-rust's runs under the sidebar's edge. */}
      <h2 className="flex min-h-7 items-center gap-2 px-1.5 text-[17px] leading-6 font-[650] wrap-anywhere max-md:pr-10">{workspaceName}</h2>

      <section aria-label="Rooms" className="flex flex-col">
        <p id={helpId} className="sr-only">
          Hold a starred room to drag it, or press Alt and the up or down arrow to reorder your favorites. Other rooms follow the workspace order.
        </p>
        <span id={unreadId} hidden>
          Unread
        </span>
        <div ref={listRef} {...listProps} className={cn("flex flex-col gap-[3px]", moving && "select-none")}>
          {listed.map((room) => {
            const unread = markedUnread(room, currentRoomId);
            const star = starred.has(room.id);
            return (
              <a
                key={room.id}
                data-room-id={room.id}
                href={roomPath(room.id)}
                draggable={false}
                aria-current={room.id === currentRoomId ? "page" : undefined}
                // Every row says how the stars are reordered, as ember-rust's do, and a marked one says it's
                // unread, which ember-rust's shows only by its weight and dot.
                aria-describedby={unread ? `${unreadId} ${helpId}` : helpId}
                aria-keyshortcuts={star ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                onClick={(event) => select(event, room.id)}
                className={cn(
                  ROW,
                  "[-webkit-touch-callout:none]",
                  unread && "font-[650]",
                  star && "cursor-grab",
                  room.id === moving && "relative z-[1] cursor-grabbing bg-background! shadow-[0_4px_14px_var(--color-drag-shadow)] outline outline-muted-foreground",
                )}
              >
                <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
                <span className="truncate">{room.name}</span>
                {/* The grip, dot and star sit together at the row's end. ember-rust's grip and dot each take an auto
                    margin, which leaves an unread starred row's grip halfway along. */}
                {star && (
                  <span aria-hidden="true" className="ml-auto inline-flex shrink-0 text-muted-foreground">
                    <GripVertical className="size-3.5" />
                  </span>
                )}
                {unread && <span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full bg-foreground", !star && "ml-auto")} />}
                {star && (
                  <span role="img" aria-label="Favorite" className="shrink-0 text-[14px] text-muted-foreground">
                    ★
                  </span>
                )}
              </a>
            );
          })}
        </div>
        {/* Moves are told to screen readers, and a save that fails is shown, as ember-rust's `.mb-channel-order-status`. */}
        <p role="status" className={status?.error ? "mx-[9px] my-1 text-xs leading-normal text-negative wrap-anywhere" : "sr-only"}>
          {status?.message}
        </p>
      </section>

      <section aria-labelledby="directs-heading" className="flex flex-col gap-[3px]">
        <div className="mb-[5px] flex items-center gap-2 px-[9px] text-xs font-medium text-muted-foreground">
          <h3 id="directs-heading">DMs</h3>
          <a
            href={NEW_DIRECT_PATH}
            title="New direct message"
            aria-label="New direct message"
            onClick={opensNewDirect(onNewDirect)}
            className="ml-auto flex size-7 items-center justify-center rounded-lg text-foreground hover:bg-hover touch:size-11"
          >
            <MessagesAdd className="size-[15px]" />
          </a>
        </div>
        {directs.map((room) => (
          <DirectRow
            key={room.id}
            room={room}
            meId={meId}
            current={room.id === currentRoomId}
            unreadId={markedUnread(room, currentRoomId) ? unreadId : null}
            onClick={(event) => select(event, room.id)}
          />
        ))}
        {!unreadOnly && !hasDirects && <p className="px-[9px] text-[13px] text-muted-foreground">No direct messages yet.</p>}
      </section>
      {unreadOnly && listed.length === 0 && directs.length === 0 && (
        <p className="px-[9px] text-[13px] text-muted-foreground">You’re all caught up. No unread conversations.</p>
      )}
    </div>
  );
}

interface DirectRowProps {
  room: DirectSidebarRoom;
  meId: UserId;
  /** Whether it's the DM the tab shows. */
  current: boolean;
  /** The element saying the DM is unread, when it's marked so, or null. */
  unreadId: string | null;
  onClick: (event: MouseEvent) => void;
}

/**
 * A DM's row, as ember-rust's `_direct.html` draws it: the avatar of the one other person in it, or of
 * up to four in a group, at 24px or 14px each (zz-ember.css, `.direct .avatar__group`), then their names,
 * or yours in a DM with yourself.
 */
function DirectRow({ room, meId, current, unreadId, onClick }: DirectRowProps) {
  const nameOf = useNameOf();
  const members = membersShown(room, meId);
  return (
    <a
      href={roomPath(room.id)}
      aria-current={current ? "page" : undefined}
      aria-describedby={unreadId ?? undefined}
      onClick={onClick}
      className={cn(ROW, unreadId && "font-[650]")}
    >
      {members.length > 1 ? (
        // Campfire's `.avatar__group` (avatars.css): two to a row, centered on the 24px a single avatar takes.
        <span aria-hidden="true" className="grid size-6 shrink-0 grid-cols-2 grid-rows-[min-content] place-content-center gap-px">
          {members.slice(0, MAX_FACES).map((member) => (
            <UserAvatar key={member.id} user={member} className="size-3.5" />
          ))}
        </span>
      ) : (
        members.map((member) => <UserAvatar key={member.id} user={member} className="size-6" />)
      )}
      {/* The space after the hidden words starts the visible line, where it doesn't show. */}
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Direct message with</span> {members.map((member) => `${nameOf(member)}${member.id === meId ? " (you)" : ""}`).join(", ")}
      </span>
      {unreadId && <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-foreground" />}
    </a>
  );
}
