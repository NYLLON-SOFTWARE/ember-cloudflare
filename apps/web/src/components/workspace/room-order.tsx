import { useId, useMemo } from "react";
import type { Me, RoomId, SharedRoom } from "@ember/protocol";
import { GripVertical } from "@/components/icons/lucide";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { roomSettingsPath } from "@/hooks/use-route";
import { useSharedOrder } from "@/hooks/use-shared-order";
import { cn } from "@/lib/utils";

/**
 * `.mb-admin-room-order-actions .btn`: Campfire's `.btn`, 40px tall, 44px for fingers. Disabled, it's
 * dimmed as Campfire dims a disabled submit button, where ember-rust's look the same either way.
 */
const ACTION =
  "inline-flex min-h-10 cursor-pointer items-center justify-center rounded-[9px] border px-3.5 py-2 font-medium touch:min-h-11 disabled:cursor-not-allowed disabled:opacity-50 disabled:grayscale disabled:contrast-50";

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
 * The order rooms come in for everyone, in workspace settings' Rooms and permissions, as ember-rust's
 * pull request #24 stages it (accounts/_room_settings.html, `.mb-admin-room-order` in zz-ember.css): a row
 * per room, dragged by its grip or moved with Alt and an arrow (`useSharedOrder`), then Save order or
 * Cancel. The rest of each row links to the room's settings, saying who it's open to. What the list last
 * said about a move shows under it.
 */
export function RoomOrder({ rooms, sharedOrder, onSaved, onSessionChanged }: Props) {
  const { order, moving, status, changed, saving, listRef, listProps, save, reset } = useSharedOrder({ rooms, sharedOrder, onSaved, onSessionChanged });
  const byId = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const helpId = useId();
  return (
    <div className="border-t">
      <p id={helpId} className="my-[1em] text-[0.8em] text-muted-foreground">
        Drag a room to reorder your community sidebar. Click a room to set its permissions.
      </p>
      <div
        ref={listRef}
        {...listProps}
        role="list"
        aria-label="Room order"
        className={cn("max-h-[360px] overflow-y-auto overscroll-contain rounded-[10px] border bg-background", moving && "select-none")}
      >
        {order.map((id) => {
          const room = byId.get(id);
          if (!room) return null;
          return (
            <div
              key={id}
              role="listitem"
              tabIndex={0}
              data-room-id={id}
              aria-describedby={helpId}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              className={cn(
                "flex min-h-[52px] items-center gap-2.5 py-1 pr-3 pl-1 not-first:border-t focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-muted-foreground",
                id === moving && "bg-hover shadow-[inset_3px_0_var(--color-foreground)]",
              )}
            >
              {/* `.mb-room-order-handle`, 44px wide for fingers, where ember-rust's is 36px, which a fingertip on it
                  can miss for the row around it. */}
              <button
                type="button"
                data-room-order-handle
                aria-label={`Move ${room.name}`}
                title="Drag to reorder, or press Alt + Up / Down"
                className="inline-flex min-h-11 min-w-9 cursor-grab touch-none items-center justify-center rounded-md p-2 text-muted-foreground touch:min-w-11 hover:bg-hover hover:text-foreground"
              >
                <GripVertical className="size-[18px]" />
              </button>
              {/* `.mb-admin-room-settings`, filling the row beside the grip, with `.mb-room-access-pill` at its end. */}
              <PageLink
                href={roomSettingsPath(room.kind, room.id)}
                aria-label={`Settings for ${room.name}`}
                className="group flex min-w-0 flex-1 items-center gap-2.5 self-stretch"
              >
                <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
                <span className="min-w-0 truncate group-hover:underline">{room.name}</span>
                <span className="ml-auto shrink-0 rounded-full border bg-hover px-2 py-[3px] text-[11px] whitespace-nowrap text-muted-foreground">
                  {room.kind === "closed" ? "Selected people" : "Everyone"}
                </span>
              </PageLink>
            </div>
          );
        })}
      </div>
      {order.length === 0 && <p className="my-[1em] text-[0.8em] text-muted-foreground">No rooms to arrange yet.</p>}
      <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
        {/* Always there for screen readers to hear, it takes no room until it says something, as ember-rust's
            `.mb-channel-order-status` is hidden until then. */}
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
    </div>
  );
}
