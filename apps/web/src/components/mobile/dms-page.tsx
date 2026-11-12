import { useMemo, useState } from "react";
import type { Me, SidebarRoom } from "@ember/protocol";
import { PageLink } from "@/components/page-link";
import { useNameOf } from "@/hooks/use-directory";
import { roomPath } from "@/hooks/use-route";
import { membersShown } from "@/lib/directs";
import { relativeTime } from "@/lib/relative-time";
import { apart, inDirectOrder, markedUnread, type DirectSidebarRoom } from "@/lib/room-list";
import { AgentBadge, useIsWithAgent } from "../workspace/agent-badge";
import { UserAvatar } from "../workspace/user-avatar";
import { Chips, EmptyList, NewMessageButton, TabList, TabPage, TabRow, TabTitle, YouLink } from "./tab-page";

/** How many people the row of faces at the top shows. */
const FACES = 12;

type Filter = "all" | "unread";

interface Props {
  me: Me;
  rooms: SidebarRoom[];
  /** Whether the rooms have loaded, before which nothing says there are none. */
  loaded: boolean;
  onNewDirect: (opener: HTMLElement) => void;
}

/**
 * DMs on a phone, Slack's: the people you have DMs with most recently in a row of faces you can scroll
 * sideways, All and Unreads, and the DMs, latest active first, each with who's in it, when it was last
 * active, and a dot while it's unread, with New direct message floating over their bottom right.
 */
export function DmsPage({ me, rooms, loaded, onNewDirect }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const directs = useMemo(() => inDirectOrder(apart(rooms).directs), [rooms]);
  const shown = filter === "unread" ? directs.filter((room) => markedUnread(room, null)) : directs;
  const faces = directs.filter((room) => membersShown(room, me.id).length === 1).slice(0, FACES);
  return (
    <TabPage heading={<TabTitle>DMs</TabTitle>} actions={<YouLink me={me} />} floating={<NewMessageButton onNewDirect={onNewDirect} />}>
      {faces.length > 0 && <Faces rooms={faces} meId={me.id} />}
      <Chips
        label="Show"
        chips={[
          { value: "all", label: "All" },
          { value: "unread", label: "Unreads" },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <TabList aria-label="Direct messages">
        {shown.map((room) => (
          <DirectRow key={room.id} room={room} meId={me.id} />
        ))}
        {loaded && shown.length === 0 && <EmptyList>{filter === "unread" ? "You’re all caught up. No unread DMs." : "No DMs yet. Start one with the + button."}</EmptyList>}
      </TabList>
    </TabPage>
  );
}

/** The faces of the people you have DMs with, latest first, each a link to the DM. */
function Faces({ rooms, meId }: { rooms: DirectSidebarRoom[]; meId: string }) {
  const nameOf = useNameOf();
  return (
    <ul aria-label="Recent" className="flex shrink-0 gap-3 overflow-x-auto px-4 pt-3 [scrollbar-width:none]">
      {rooms.map((room) => {
        const person = membersShown(room, meId)[0]!;
        return (
          <li key={room.id} className="shrink-0">
            <PageLink href={roomPath(room.id)} className="flex w-16 flex-col items-center gap-1 text-foreground no-underline">
              <UserAvatar user={person} square className="size-16 rounded-xl" />
              <span className="w-full truncate text-center text-[13px] leading-4">{nameOf(person)}</span>
            </PageLink>
          </li>
        );
      })}
    </ul>
  );
}

/** A DM's row: who's in it, their faces, when it was last active, and whether it's unread. */
function DirectRow({ room, meId }: { room: DirectSidebarRoom; meId: string }) {
  const nameOf = useNameOf();
  const isWithAgent = useIsWithAgent();
  const members = membersShown(room, meId);
  return (
    <TabRow
      href={roomPath(room.id)}
      unread={markedUnread(room, null)}
      leading={
        members.length > 1 ? (
          <span aria-hidden="true" className="grid size-9 grid-cols-2 place-content-center gap-px">
            {members.slice(0, 4).map((member) => (
              <UserAvatar key={member.id} user={member} square className="size-[17px] rounded-[4px]" />
            ))}
          </span>
        ) : (
          <UserAvatar user={members[0]!} square className="size-9 rounded-lg" />
        )
      }
      title={
        <>
          <span className="sr-only">Direct message with</span> {members.map((member) => `${nameOf(member)}${member.id === meId ? " (you)" : ""}`).join(", ")}
          {isWithAgent(room) && <AgentBadge className="ms-1" />}
        </>
      }
      trailing={<time dateTime={room.activeAt}>{relativeTime(room.activeAt)}</time>}
    />
  );
}
