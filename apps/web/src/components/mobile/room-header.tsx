import { useContext, useEffect, useId, useState } from "react";
import { ACTIVITY_PATH, DMS_PATH, type Room, type User } from "@ember/protocol";
import { ChatBubbleEmpty, Lock } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { roomSettingsPath, usePath } from "@/hooks/use-route";
import { fetchPerson, fetchRoomSettings } from "@/lib/api";
import { fetchTabs } from "@/lib/library";
import { cn } from "@/lib/utils";
import { AgentBadge, useIsWithAgent } from "../workspace/agent-badge";
import { HuddleButton } from "../workspace/huddle-button";
import { PageHeader } from "../workspace/page-header";
import { useLocalTime } from "../workspace/profile-pane";
import type { RoomHeaderProps } from "../workspace/room-header";
import { RoomTabsContext } from "../workspace/room-tabs";
import { BackButton } from "./back-button";
import { DirectAvatar, personOfDirect } from "./direct-person";
import { RoomDetailsSheet } from "./room-details-sheet";

/** A capsule in a phone's top bar: 44px tall, round at each end, as Back is. */
// Its edge is a ring rather than a border, so what fills it is the capsule's whole 44px, a fingertip's.
export const CAPSULE = "h-11 rounded-full bg-surface ring-1 ring-border ring-inset";

/**
 * A room's top bar on a phone, Slack's: Back, then a pill with the room's name and a line under it, which
 * opens the room's details sheet, with its tabs, star, bell, members, Search and settings, then the huddle
 * button once huddles are on. A DM with one person has their avatar for the room's icon, and under their
 * name whether they're here and their time; a sub-room has its parent's name in that line.
 */
export function MobileRoomHeader(props: RoomHeaderProps) {
  const { room, me, name, present, status, offline } = props;
  const isWithAgent = useIsWithAgent();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const direct = room.kind === "direct";
  const huddles = useAccount().huddles && !direct;
  const person = personOfDirect(room, me.id);
  const here = person !== null && present.some((user) => user.id === person.id);
  const about = useAbout(room, person, here);
  const detail = offline ? (status === "connecting" ? "Connecting…" : "Reconnecting…") : about;
  const ids = { name: useId(), detail: useId() };
  // With nothing to go back to, as when a link opened it, Back goes up to where it's shown: Activity, for a
  // room it opened, or the DMs or Home.
  const inActivity = usePath().startsWith(`${ACTIVITY_PATH}/`);
  return (
    <PageHeader>
      <BackButton fallback={inActivity ? ACTIVITY_PATH : direct ? DMS_PATH : "/"} />
      {/* The pill reads as the room's name and its line, and a tap anywhere on it opens the room's details. */}
      <div className={`relative flex min-w-0 flex-1 items-center gap-2 py-1 pr-4 pl-3 text-foreground has-[>button:hover]:bg-hover ${CAPSULE}`}>
        {person ? (
          <DirectAvatar person={person} here={here} edge="border-surface" className="size-7" />
        ) : direct ? (
          <ChatBubbleEmpty className="size-5 shrink-0" />
        ) : room.kind === "closed" && room.icon === null ? (
          // A private room without an icon of its own has a lock where an open one has `#`, as in the sidebar.
          <Lock aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        ) : (
          <RoomIcon icon={room.icon} size={20} className="shrink-0 text-[20px] text-muted-foreground" />
        )}
        <span className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-1">
            <h1 id={ids.name} className="min-w-0 truncate text-base leading-5 font-bold">
              {direct && <span className="sr-only">Direct message with</span>} {room.kind !== "direct" ? room.name : name}
            </h1>
            {isWithAgent(room) && <AgentBadge />}
          </span>
          {/* The composer's disabled while it's offline; this says why. */}
          {detail && (
            <span id={ids.detail} role={offline ? "status" : undefined} className="truncate text-xs leading-4 text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-labelledby={detail ? `${ids.name} ${ids.detail}` : ids.name}
          aria-haspopup="dialog"
          onClick={() => setDetailsOpen(true)}
          className="absolute inset-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-foreground"
        />
      </div>
      {/* Who's here, which a phone has no room to show, as the wider top bar doesn't up to 500px. */}
      <span className="sr-only">{present.length} here now</span>
      {huddles && (
        <div className={`flex shrink-0 items-stretch overflow-hidden [&>div]:h-auto [&>div]:flex-1 [&>div]:rounded-full [&_button]:min-w-11 ${CAPSULE}`}>
          <HuddleButton roomId={room.id} />
        </div>
      )}
      <RoomDetailsSheet {...props} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </PageHeader>
  );
}

/**
 * The line under the room's name: whether the person a DM is with is here, and their time; how many are in
 * a group DM; and a room's parent, for a sub-room, how many are in it, and the tab shown, or else how many
 * tabs of its own it has, since the details sheet lists them.
 */
function useAbout(room: Room, person: User | null, here: boolean): string | null {
  const members = useMemberCount(room);
  const tabs = useContext(RoomTabsContext);
  const time = useLocalTime(useTimeZone(person));
  if (person) return [here ? "Active" : null, time && `${time} local`].filter(Boolean).join(" · ") || null;
  const custom = tabs?.tabs.find((tab) => tab.id === tabs.shown);
  const tab = tabs?.shown === "files" ? "Files & links" : custom ? custom.title : tabs && tabs.tabs.length > 0 ? countOf(tabs.tabs.length, "tab") : null;
  const parent = room.kind !== "direct" ? room.parent?.name : undefined;
  return [parent, members === null ? null : countOf(members, "member"), tab].filter(Boolean).join(" · ") || null;
}

const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The time zone of `person`, once their page has said it, or null. */
function useTimeZone(person: User | null): string | null {
  const [loaded, setLoaded] = useState<{ userId: string; timeZone: string | null } | null>(null);
  const userId = person?.id;
  useEffect(() => {
    if (!userId) return;
    let current = true;
    // Without it, the line leaves their time out rather than saying it wrong.
    fetchPerson(userId).then((answer) => current && setLoaded({ userId, timeZone: answer.person.timeZone ?? null }), () => {});
    return () => void (current = false);
  }, [userId]);
  return loaded !== null && loaded.userId === userId ? loaded.timeZone : null;
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
