import type { SidebarRoom } from "@ember/protocol";
import { MessagesAdd } from "@/components/icons/campfire";
import { RoomIcon } from "@/components/icons/room-icon";
import { roomPath } from "@/hooks/use-route";
import { cn } from "@/lib/utils";

interface Props {
  /** The workspace's name, which heads the list, as ember-rust's users/sidebars/show.html has it. */
  workspaceName: string;
  rooms: SidebarRoom[];
  currentRoomId: string | null;
  onSelect: (roomId: string) => void;
}

/**
 * The conversation list: rooms, then DMs, under the workspace name. A room marked unread is bold with
 * a dot at the end of its row, as ember-rust's `.unread` and `.mb-room-status` are (zz-ember.css),
 * except the room the tab shows, which rooms_list_controller.js never marks.
 */
export function Sidebar({ workspaceName, rooms, currentRoomId, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto overflow-x-hidden bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] narrow:px-2 max-md:gap-4 max-md:px-2.5 max-md:pt-4 max-md:pb-[max(16px,env(safe-area-inset-bottom))]">
      {/* At 900px and below the drawer's close button sits at the end of this row. A long name wraps where
          ember-rust's runs under the sidebar's edge. */}
      <h2 className="flex min-h-7 items-center gap-2 px-1.5 text-[17px] leading-6 font-[650] wrap-anywhere max-md:pr-10">{workspaceName}</h2>

      <section aria-label="Rooms" className="flex flex-col gap-[3px]">
        {rooms.map((room) => {
          const unread = room.unread && room.id !== currentRoomId;
          return (
            <a
              key={room.id}
              href={roomPath(room.id)}
              aria-current={room.id === currentRoomId ? "page" : undefined}
              // ember-rust shows the mark only by its weight and dot; this tells screen readers too.
              aria-description={unread ? "Unread" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                onSelect(room.id);
              }}
              className={cn(
                "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11",
                "hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold",
                unread && "font-[650]",
              )}
            >
              <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
              <span className="truncate">{room.name}</span>
              {unread && <span aria-hidden="true" className="ml-auto size-[7px] shrink-0 rounded-full bg-foreground" />}
            </a>
          );
        })}
      </section>

      <section aria-labelledby="directs-heading" className="flex flex-col gap-[3px]">
        <div className="mb-[5px] flex items-center gap-2 px-[9px] text-xs font-medium text-muted-foreground">
          <h3 id="directs-heading">DMs</h3>
          <button
            type="button"
            disabled
            title="Direct messages aren't built yet"
            aria-label="New direct message"
            className="ml-auto flex size-7 items-center justify-center rounded-lg hover:bg-hover disabled:opacity-50 touch:size-11"
          >
            <MessagesAdd className="size-[15px]" />
          </button>
        </div>
        <p className="px-[9px] text-[13px] text-muted-foreground">No direct messages yet.</p>
      </section>
    </div>
  );
}
