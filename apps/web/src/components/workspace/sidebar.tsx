import { MessagesAdd } from "@/components/icons/campfire";
import { RoomIcon } from "@/components/icons/room-icon";
import { roomPath } from "@/hooks/use-route";
import type { Room } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The conversation list: rooms, then DMs, under the workspace name. */
export function Sidebar({ rooms, currentRoomId, onSelect }: { rooms: Room[]; currentRoomId: string | null; onSelect: (roomId: string) => void }) {
  return (
    <div className="flex h-full flex-col gap-3.5 overflow-y-auto overflow-x-hidden bg-surface px-3 pt-5 pb-[max(20px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable]">
      {/* Below 900px the drawer's close button sits at the end of this row. */}
      <h2 className="flex min-h-7 items-center gap-2 px-1.5 text-[17px] leading-6 font-[650] max-md:pr-10">Ember</h2>

      <section aria-label="Rooms" className="flex flex-col gap-[3px]">
        {rooms.map((room) => (
          <a
            key={room.id}
            href={roomPath(room.id)}
            aria-current={room.id === currentRoomId ? "page" : undefined}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onSelect(room.id);
            }}
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-sm leading-[22px] text-foreground no-underline touch:min-h-11",
              "hover:bg-hover aria-[current=page]:bg-hover aria-[current=page]:font-semibold",
            )}
          >
            <RoomIcon icon={room.icon} size={19} className="w-[18px] shrink-0 text-center text-[22px] leading-none text-muted-foreground" />
            <span className="truncate">{room.name}</span>
          </a>
        ))}
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
