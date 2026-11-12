import { useContext, useEffect, useState } from "react";
import type { Room } from "@ember/protocol";
import { ChatBubbleEmpty } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { roomSettingsPath } from "@/hooks/use-route";
import { fetchRoomSettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentBadge, useIsWithAgent } from "../workspace/agent-badge";
import { FavoriteButton } from "../workspace/favorite-button";
import { HuddleButton } from "../workspace/huddle-button";
import { NotificationBell } from "../workspace/notification-bell";
import { HEADER_BUTTON, PageHeader } from "../workspace/page-header";
import type { RoomHeaderProps } from "../workspace/room-header";
import { BackButton } from "./back-button";
import { DMS_PATH } from "./tabs";

/**
 * A room's top bar on a phone, Slack's: Back, then a pill with the room's name and how many are in it,
 * which opens the room's settings, then a pill with the star, the huddle button once huddles are on, and
 * the bell. A DM's has a chat bubble for the room's icon, and only the bell. Search is in the tab bar.
 */
export function MobileRoomHeader({ room, name, present, status, offline, favorite, onStarred, involvement, askForRoom, onSessionChanged, onFailed }: RoomHeaderProps) {
  const isWithAgent = useIsWithAgent();
  const direct = room.kind === "direct";
  const huddles = useAccount().huddles && !direct;
  const members = useMemberCount(room);
  const detail = offline ? (status === "connecting" ? "Connecting…" : "Reconnecting…") : members === null ? null : `${members} ${members === 1 ? "member" : "members"}`;
  return (
    <PageHeader>
      <BackButton fallback={direct ? DMS_PATH : "/"} />
      <PageLink
        href={roomSettingsPath(room.kind, room.id)}
        title="Conversation settings"
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border bg-surface py-1 pr-4 pl-3 text-foreground no-underline hover:bg-hover"
      >
        {direct ? <ChatBubbleEmpty className="size-5 shrink-0" /> : <RoomIcon icon={room.icon} size={20} className="shrink-0 text-[20px] text-muted-foreground" />}
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <h1 className="truncate text-base leading-5 font-bold">
              {direct && <span className="sr-only">Direct message with </span>}
              {name}
            </h1>
            {isWithAgent(room) && <AgentBadge />}
          </span>
          {/* The composer's disabled while it's offline; this says why. */}
          {detail && (
            <span role={offline ? "status" : undefined} className="truncate text-xs leading-4 text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
      </PageLink>
      {/* Who's here, which a phone has no room to show, as the wider top bar doesn't up to 500px. */}
      <span className="sr-only">{present.length} here now</span>
      <div className="flex shrink-0 items-center rounded-full border bg-surface [&>*]:rounded-full">
        {!direct && <FavoriteButton roomId={room.id} favorite={favorite} onSaved={onStarred} onSessionChanged={onSessionChanged} />}
        {huddles && <HuddleButton roomId={room.id} />}
        <NotificationBell room={room} involvement={involvement} askForRoom={askForRoom} onFailed={onFailed} className={cn(HEADER_BUTTON, "rounded-full [&>svg]:size-5")} />
      </div>
    </PageHeader>
  );
}

/**
 * How many people are in a room: a DM's members, everyone active for a room open to everyone, as the
 * people directory lists them, and a private room's members, as its settings say, once they've loaded.
 */
function useMemberCount(room: Room): number | null {
  const people = useContext(PeopleContext);
  const [closed, setClosed] = useState<{ roomId: string; count: number } | null>(null);
  const roomId = room.id;
  const kind = room.kind;
  useEffect(() => {
    if (kind !== "closed") return;
    let current = true;
    fetchRoomSettings(roomId).then(
      (settings) => current && setClosed({ roomId, count: settings.people.filter((person) => person.member).length }),
      // The count is left out rather than said wrong.
      () => {},
    );
    return () => void (current = false);
  }, [roomId, kind]);
  if (room.kind === "direct") return room.members.length;
  if (room.kind === "open") return people.size === 0 ? null : [...people.values()].filter((person) => person.status === "active").length;
  return closed?.roomId === room.id ? closed.count : null;
}
