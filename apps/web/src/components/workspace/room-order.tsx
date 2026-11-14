import { useId, useState, type ReactNode } from "react";
import type { Me, RoomId, SharedRoom } from "@ember/protocol";
import { DotsGrid3x3, NavArrowRight, Plus } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { newSubRoomPath, roomSettingsPath, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { useRoomDrag } from "@/hooks/use-room-drag";
import { useSharedOrder } from "@/hooks/use-shared-order";
import type { RoomBranch } from "@/lib/sub-rooms";
import { cn } from "@/lib/utils";
import { UnsavedChanges } from "./unsaved-changes";

/**
 * Save order and Cancel: Campfire's `.btn`, 40px tall, 44px for fingers. Disabled, each is dimmed as
 * Campfire dims a disabled submit button.
 */
const ACTION =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[9px] border px-3.5 py-2 font-medium touch:min-h-11 disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale disabled:contrast-50";

/** What the unsaved changes dialog says about an order staged, as it says of a room's form. */
const ORDER_CHANGES = "You’ve changed the room order. Save it before you leave, or discard it to keep things as they were.";

/** Whether going to `path` keeps workspace settings, as Back and Forward between its sections do. */
const staysInSettings = (path: string) => path === WORKSPACE_SETTINGS_PATH;

interface Props {
  /** The rooms in this administrator's sidebar, but their DMs, in any order. */
  rooms: SharedRoom[];
  /** The ones of them the shared order ranks, in its order. */
  sharedOrder: RoomId[];
  /** Called with the rooms of theirs the shared order ranks, as the server answers them, once an order is saved. */
  onSaved: (sharedOrder: RoomId[]) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * The order rooms come in for everyone, in workspace settings' Rooms and permissions: a row per room,
 * dragged by its grip or moved with Alt and an arrow (`useSharedOrder`), then Save order or Cancel. The
 * rest of each row links to the room's settings, saying who it's open to. What the list last said about
 * a move shows under it. Leaving the page with an order staged asks to save or discard it, as leaving a
 * room's form does.
 */
export function RoomOrder({ rooms, sharedOrder, onSaved, onSessionChanged }: Props) {
  const { tree, subRoomDrag, moving, status, changed, saving, listRef, listProps, save, reset } = useSharedOrder({ rooms, sharedOrder, onSaved, onSessionChanged });
  const [expanded, setExpanded] = useState<ReadonlySet<RoomId>>(new Set());
  const helpId = useId();

  /** Saves the order staged for the unsaved changes dialog, which says so when it isn't saved. */
  const saveBeforeLeaving = async () => {
    if (!(await save())) throw new Error("The room order wasn't saved");
  };

  const toggle = (roomId: RoomId) =>
    setExpanded((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(roomId)) next.add(roomId);
      return next;
    });

  return (
    <div className="border-t">
      {/* The grips and the rows say what they do as they're reached, so this is for screen readers alone. */}
      <p id={helpId} className="sr-only">
        Drag a room, or press Alt and Up or Down, to reorder the sidebar.
      </p>
      <div
        ref={listRef}
        {...listProps}
        role="list"
        aria-label="Room order"
        className={cn("mt-[1em] max-h-[360px] overflow-y-auto overscroll-contain rounded-[10px] border bg-background", moving && "select-none")}
      >
        {tree.map((branch) => (
          <ParentRow
            key={branch.room.id}
            branch={branch}
            helpId={helpId}
            moving={branch.room.id === moving}
            expanded={expanded.has(branch.room.id)}
            onToggle={() => toggle(branch.room.id)}
            drag={subRoomDrag(branch.room.id)}
          />
        ))}
      </div>
      {tree.length === 0 && <p className="my-[1em] text-[0.8em] text-muted-foreground">No rooms to arrange yet.</p>}
      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
        {/* Always there for screen readers to hear, it takes no room until it says something. */}
        <p role="status" aria-live="polite" className={cn("basis-full", status?.error ? "text-negative" : "text-muted-foreground", !status && "sr-only")}>
          {status?.message}
        </p>
        <button type="button" disabled={saving || !changed} onClick={reset} className={cn(ACTION, "bg-background text-foreground")}>
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || !changed}
          onClick={() => void save()}
          className={cn(ACTION, "border-transparent bg-foreground text-background hover:not-active:brightness-70")}
        >
          Save order
        </button>
      </div>
      <UnsavedChanges changed={changed} stays={staysInSettings} onSave={saveBeforeLeaving} description={ORDER_CHANGES} />
    </div>
  );
}

/** How a row being dragged stands out. */
const MOVING = "bg-hover shadow-[inset_3px_0_var(--color-foreground)]";

/** A row's actions, shown with a pointer as the row is hovered or has focus, and always to fingers. */
const ON_HOVER = "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 touch:opacity-100";

/** Each of a row's two trailing slots, New sub-room and the sub-rooms' arrow, kept where neither applies so who it's open to lines up. */
const SLOT = "size-9 shrink-0 touch:size-11";

/** A slot's control. */
const SLOT_CONTROL = cn(SLOT, "inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground");

/** Who a room in the order is open to: for an open sub-room, its parent's people. */
function accessOf(room: SharedRoom): string {
  if (room.kind === "closed") return "Selected people";
  return room.parent ? `Everyone in ${room.parent.name}` : "Everyone";
}

/**
 * A room's row in the order: its grip, then a link to its settings, saying who it's open to, then its two
 * trailing slots, which `children` fills.
 */
function OrderRow({ room, helpId, sub = false, children }: { room: SharedRoom; helpId: string; sub?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("group/row flex min-h-[52px] items-center gap-2.5 py-1 pr-3 pl-1", sub && "pl-6")}>
      {/* The grip, 44px wide, so a fingertip on it doesn't land on the row around it instead. */}
      <button
        type="button"
        data-room-order-handle
        aria-label={`Move ${room.name}`}
        aria-describedby={helpId}
        title="Drag to reorder, or press Alt + Up / Down"
        className={cn(
          "inline-flex min-h-11 min-w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md p-2 text-muted-foreground touch:min-w-11 hover:bg-hover hover:text-foreground",
          ON_HOVER,
        )}
      >
        <DotsGrid3x3 className="size-[18px]" />
      </button>
      {/* The room's settings, filling the row beside the grip, with who it's open to at its end. */}
      <PageLink href={roomSettingsPath(room.kind, room.id)} aria-label={`Settings for ${room.name}`} className="group flex min-w-0 flex-1 items-center gap-2.5 self-stretch">
        <RoomIcon icon={room.icon} closed={room.kind === "closed"} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
        <span className="min-w-0 truncate group-hover:underline">{room.name}</span>
        <span className="ml-auto max-w-[50%] shrink-0 truncate rounded-full border bg-hover px-2 py-[3px] text-[11px] whitespace-nowrap text-muted-foreground max-[379px]:hidden">
          {accessOf(room)}
        </span>
      </PageLink>
      {children ?? (
        <>
          <span aria-hidden className={SLOT} />
          <span aria-hidden className={SLOT} />
        </>
      )}
    </div>
  );
}

/** What `useRoomDrag` takes for a parent's list of sub-rooms (`useSharedOrder`'s `subRoomDrag`). */
type SubRoomDrag = ReturnType<ReturnType<typeof useSharedOrder>["subRoomDrag"]>;

interface ParentRowProps {
  branch: RoomBranch<SharedRoom>;
  helpId: string;
  moving: boolean;
  expanded: boolean;
  onToggle: () => void;
  drag: SubRoomDrag;
}

/**
 * A room of its own in the order, which drags with its sub-rooms: its row, New sub-room, and once it has
 * sub-rooms, an arrow that shows or hides them, in a list of their own under it, where each drags among
 * the others.
 */
function ParentRow({ branch, helpId, moving, expanded, onToggle, drag: options }: ParentRowProps) {
  const { room, subRooms } = branch;
  const drag = useRoomDrag(options);
  const byId = new Map(subRooms.map((sub) => [sub.id, sub]));
  const groupId = useId();
  return (
    <div
      role="listitem"
      tabIndex={0}
      data-room-id={room.id}
      aria-describedby={helpId}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      className={cn("not-first:border-t focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground", moving && MOVING)}
    >
      <OrderRow room={room} helpId={helpId}>
        <PageLink
          href={newSubRoomPath(room.id)}
          title={`New sub-room in ${room.name}`}
          aria-label={`New sub-room in ${room.name}`}
          className={cn(SLOT_CONTROL, ON_HOVER)}
        >
          <Plus className="size-[18px]" />
        </PageLink>
        {subRooms.length === 0 ? (
          <span aria-hidden className={SLOT} />
        ) : (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={groupId}
            aria-label={`${expanded ? "Hide" : "Show"} ${room.name}’s ${subRooms.length} sub-room${subRooms.length === 1 ? "" : "s"}`}
            onClick={onToggle}
            className={cn(SLOT_CONTROL, "cursor-pointer")}
          >
            <NavArrowRight className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
          </button>
        )}
      </OrderRow>
      {subRooms.length > 0 && expanded && (
        <div id={groupId} ref={drag.listRef} {...drag.listProps} role="list" aria-label={`${room.name}’s sub-rooms`} className="border-t">
          {drag.order.map((id) => {
            const sub = byId.get(id);
            if (!sub) return null;
            return (
              <div
                key={id}
                role="listitem"
                tabIndex={0}
                data-room-id={id}
                aria-describedby={helpId}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                className={cn("not-first:border-t focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground", id === drag.moving && MOVING)}
              >
                <OrderRow room={sub} helpId={helpId} sub />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
