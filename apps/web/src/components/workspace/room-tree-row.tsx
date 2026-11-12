import { useCallback, useId, useState, type ReactNode } from "react";
import type { RoomId, SharedRoom } from "@ember/protocol";
import { NavArrowRight } from "@/components/icons/iconoir";
import { collapsedRooms, keepCollapsed, type RoomBranch } from "@/lib/sub-rooms";
import { cn } from "@/lib/utils";

/** How the sidebar draws a room's row in its tree. */
export interface TreeRowOptions {
  /** The room's name as its row shows it: its own under its parent, and "Strata – Sales" elsewhere. */
  label: string;
  /** Whether the row shows the room unread: a collapsed parent shows its sub-rooms' too. */
  unread: boolean;
  /** Classes the row adds: a sub-room's indent, or the room a parent's arrow takes at its end. */
  className?: string;
}

/**
 * Which parents' sub-rooms this browser keeps collapsed in the sidebar, remembered across visits, and
 * what collapses or expands one.
 */
export function useCollapsedRooms() {
  const [collapsed, setCollapsed] = useState(collapsedRooms);
  const toggle = useCallback((roomId: RoomId) => {
    setCollapsed((collapsed) => {
      const next = new Set(collapsed);
      if (!next.delete(roomId)) next.add(roomId);
      keepCollapsed(next);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

interface Props<T extends SharedRoom> {
  branch: RoomBranch<T>;
  /** The parent's name as its row shows it, which a room of its own whose parent isn't listed shows with its parent's. */
  label: string;
  /** Draws a room's row, a link to the room, as the sidebar draws every room's. */
  row: (room: T, options: TreeRowOptions) => ReactNode;
  /** Whether the sidebar shows `room` unread. */
  isUnread: (room: T) => boolean;
  /** The room the tab shows, whose row shows even under a collapsed parent. */
  currentRoomId: RoomId | null;
  collapsed: boolean;
  onToggle: (roomId: RoomId) => void;
}

/**
 * A room in the sidebar's tree: its row, and for a parent, an arrow at the row's end that expands or
 * collapses its sub-rooms, indented under it. Following the parent's name opens its room, as any row's
 * does. Collapsed, the parent shows unread while any of its sub-rooms is, and the sub-room the tab shows
 * stays under it.
 */
export function RoomTreeRow<T extends SharedRoom>({ branch, label, row, isUnread, currentRoomId, collapsed, onToggle }: Props<T>) {
  const groupId = useId();
  const { room, subRooms } = branch;
  if (subRooms.length === 0) return row(room, { label, unread: isUnread(room) });
  const shown = collapsed ? subRooms.filter((sub) => sub.id === currentRoomId) : subRooms;
  const unread = isUnread(room) || (collapsed && subRooms.some(isUnread));
  return (
    <>
      <div className="relative">
        {row(room, { label, unread, className: "pr-10 touch:pr-12" })}
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={groupId}
          aria-label={`${collapsed ? "Show" : "Hide"} ${room.name}’s sub-rooms`}
          title={collapsed ? "Show sub-rooms" : "Hide sub-rooms"}
          onClick={() => onToggle(room.id)}
          className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground touch:w-11"
        >
          <NavArrowRight className={cn("size-4 transition-transform motion-reduce:transition-none", !collapsed && "rotate-90")} />
        </button>
      </div>
      <div id={groupId} role="group" aria-label={`${room.name}’s sub-rooms`} className="flex flex-col gap-[3px]">
        {shown.map((sub) => row(sub, { label: sub.name, unread: isUnread(sub), className: "pl-[30px]" }))}
      </div>
    </>
  );
}
