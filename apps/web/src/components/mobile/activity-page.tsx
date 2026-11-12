import { useMemo, useState } from "react";
import type { Me, SidebarRoom } from "@ember/protocol";
import { ChatBubbleEmpty } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { useNameOf } from "@/hooks/use-directory";
import { roomPath } from "@/hooks/use-route";
import { roomName } from "@/lib/directs";
import { relativeTime } from "@/lib/relative-time";
import { markedUnread } from "@/lib/room-list";
import { Chips, EmptyList, TabList, TabPage, TabRow, TabTitle, YouLink } from "./tab-page";

type Filter = "all" | "dms" | "rooms";

interface Props {
  me: Me;
  rooms: SidebarRoom[];
  loaded: boolean;
}

/**
 * Activity on a phone: the conversations with something you haven't read, newest first, by when it
 * started, which All, DMs and Rooms filter, each a link to its conversation.
 */
export function ActivityPage({ me, rooms, loaded }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const nameOf = useNameOf();
  const unread = useMemo(
    () => rooms.filter((room) => markedUnread(room, null)).sort((a, b) => ((a.unreadSince ?? "") < (b.unreadSince ?? "") ? 1 : -1)),
    [rooms],
  );
  const shown = unread.filter((room) => filter === "all" || (filter === "dms") === (room.kind === "direct"));
  return (
    <TabPage heading={<TabTitle>Activity</TabTitle>} actions={<YouLink me={me} />}>
      <Chips
        label="Show"
        chips={[
          { value: "all", label: "All" },
          { value: "dms", label: "DMs" },
          { value: "rooms", label: "Rooms" },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <TabList aria-label="Unread conversations">
        {shown.map((room) => (
          <TabRow
            key={room.id}
            href={roomPath(room.id)}
            unread
            leading={
              room.kind === "direct" ? (
                <ChatBubbleEmpty className="size-6 text-muted-foreground" />
              ) : (
                <RoomIcon icon={room.icon} size={24} className="text-[24px] text-muted-foreground" />
              )
            }
            title={roomName(room, me.id, nameOf)}
            detail={room.kind === "direct" ? "Direct message" : "New messages"}
            trailing={room.unreadSince && <time dateTime={room.unreadSince}>{relativeTime(room.unreadSince)}</time>}
          />
        ))}
        {loaded && shown.length === 0 && <EmptyList>You’re all caught up. No unread conversations.</EmptyList>}
      </TabList>
    </TabPage>
  );
}
