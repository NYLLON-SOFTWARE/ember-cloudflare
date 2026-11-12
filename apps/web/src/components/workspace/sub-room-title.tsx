import { SUB_ROOM_SEPARATOR, type SharedRoom } from "@ember/protocol";
import { PageLink } from "@/components/page-link";
import { roomPath } from "@/hooks/use-route";

/**
 * A sub-room's name in its header, "Strata – Sales", whose parent's name links to the parent's room,
 * which everyone in the sub-room is in too. Short of room, the parent's name gives way first, and a phone
 * under 430px wide, whose header has room for little, shows only the sub-room's own, as the sidebar
 * shows it under its parent. Any other room's is its name.
 */
export function SubRoomTitle({ room }: { room: SharedRoom }) {
  if (!room.parent) return room.name;
  return (
    <span className="flex min-w-0 items-baseline">
      <PageLink
        href={roomPath(room.parent.id)}
        title={`Go to ${room.parent.name}`}
        className="min-w-[3ch] shrink-[4] truncate text-muted-foreground no-underline hover:text-foreground hover:underline max-[429px]:hidden"
      >
        {room.parent.name}
      </PageLink>
      <span className="shrink-0 whitespace-pre max-[429px]:hidden">{SUB_ROOM_SEPARATOR}</span>
      <span className="min-w-0 truncate">{room.name}</span>
    </span>
  );
}
