import type { Favorites, Me, Room, User } from "@ember/protocol";
import { MenuDotsHorizontal, MessagesOutlined } from "@/components/icons/campfire";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { useNameOf } from "@/hooks/use-directory";
import { roomSettingsPath } from "@/hooks/use-route";
import type { ConnectionStatus } from "@/lib/room-state";
import { FavoriteButton } from "./favorite-button";
import { HEADER_BUTTON, PageHeader } from "./page-header";
import { UserAvatar } from "./user-avatar";

const MAX_FACES = 4;

interface Props {
  room: Room;
  /** Its name as whoever's reading it reads it, which for a DM names the others in it. */
  name: string;
  present: User[];
  status: ConnectionStatus;
  /** Whether the room has been without a connection long enough to say so. */
  offline: boolean;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Called with this person's stars once its star saves them. */
  onStarred: (favorites: Favorites) => void;
  onSessionChanged: (me: Me | null) => void;
}

/**
 * ember-rust's room header (rooms/show/_nav.html): the room's name, its star, who's here, and its
 * settings. A DM's has Campfire's `messages-outlined` in place of the room's icon, and no star.
 */
export function RoomHeader({ room, name, present, status, offline, favorite, onStarred, onSessionChanged }: Props) {
  const nameOf = useNameOf();
  const direct = room.kind === "direct";
  return (
    <PageHeader>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 max-md:gap-[7px]">
        {direct ? (
          <MessagesOutlined width={20} height={20} className="size-5 shrink-0" />
        ) : (
          <RoomIcon icon={room.icon} size={22} className="shrink-0 text-[23px] text-muted-foreground" />
        )}
        <h1 className="truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">
          {direct ? (
            <>
              <span className="sr-only">Direct message with</span> {name}
            </>
          ) : (
            name
          )}
        </h1>
        {!direct && <FavoriteButton roomId={room.id} favorite={favorite} onSaved={onStarred} onSessionChanged={onSessionChanged} />}
        {/* ember-rust only disables the composer once it's offline; this says why. */}
        {offline && (
          <span role="status" className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {status === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5" title={present.map(nameOf).join(", ")}>
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
        <span className="sr-only">Settings for this {direct ? "Ping" : "room"}</span>
      </PageLink>
    </PageHeader>
  );
}
