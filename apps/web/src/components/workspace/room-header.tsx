import type { Room, User } from "@ember/protocol";
import { MenuDotsHorizontal } from "@/components/icons/campfire";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { roomSettingsPath } from "@/hooks/use-route";
import type { ConnectionStatus } from "@/lib/room-state";
import { HEADER_BUTTON, PageHeader } from "./page-header";
import { UserAvatar } from "./user-avatar";

const MAX_FACES = 4;

/** ember-rust's room header (rooms/show/_nav.html): the room's name, who's here, and its settings. */
export function RoomHeader({ room, present, status }: { room: Room; present: User[]; status: ConnectionStatus }) {
  return (
    <PageHeader>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 max-md:gap-[7px]">
        <RoomIcon icon={room.icon} size={22} className="shrink-0 text-[23px] text-muted-foreground" />
        <h1 className="truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">{room.name}</h1>
        {(status === "connecting" || status === "reconnecting") && (
          <span role="status" className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {status === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5" title={present.map((u) => u.name).join(", ")}>
        <span className="sr-only">{present.length} here now</span>
        <div className="flex -space-x-1.5" aria-hidden="true">
          {present.slice(0, MAX_FACES).map((user) => (
            <UserAvatar key={user.id} user={user} className="size-7 ring-2 ring-background" />
          ))}
        </div>
        {present.length > MAX_FACES && <span className="text-xs text-muted-foreground">+{present.length - MAX_FACES}</span>}
      </div>

      <PageLink href={roomSettingsPath(room.kind, room.id)} title="Conversation settings" className={HEADER_BUTTON}>
        <MenuDotsHorizontal className="size-5" />
        <span className="sr-only">Settings for this room</span>
      </PageLink>
    </PageHeader>
  );
}
