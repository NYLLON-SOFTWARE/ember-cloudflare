import { useId, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { DirectPreview, RoomId, SidebarRoom, User, UserId } from "@ember/protocol";
import { ChatBubbleEmpty, ChatPlusIn, Search } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { leave, NEW_DIRECT_PATH, roomPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { activityLabel, namesMatch, previewOf, unreadBadge } from "@/lib/direct-list";
import { membersShown } from "@/lib/directs";
import { apart, inDirectOrder, markedUnread, suggestedPeople, type DirectSidebarRoom } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { AgentBadge, useIsWithAgent } from "./agent-badge";
import { opensNewDirect } from "./new-direct-dialog";
import { PageHeader } from "./page-header";
import { UserAvatar } from "./user-avatar";

/** How many avatars a group DM's row shows. */
const MAX_FACES = 4;

/** The drawer layout, 900px wide and below, as workspace.tsx has it, where the list is in the drawer rather than beside the page. */
const DRAWER_LAYOUT = "(width < 56.3125rem)";

interface Props {
  /** Who the list is for, whose DMs name the others in them. */
  meId: UserId;
  /** Someone's rooms and DMs, in any order, of which it lists the DMs. */
  rooms: SidebarRoom[];
  /** Whether their list has come, before which nothing says there's nothing in it. */
  loaded: boolean;
  /** Each DM's latest message and how many are unread, by room, as far as they've come. */
  previews: ReadonlyMap<RoomId, DirectPreview>;
  /** The people suggested for DMs, as the server last listed them. */
  suggestions: User[];
  currentRoomId: RoomId | null;
  /** Whether Activity is on, which shows only the DMs marked unread, as Unreads does. */
  unreadOnly: boolean;
  onSelect: (roomId: RoomId) => void;
  /** Opens New direct message, from the button that opened it. */
  onNewDirect: (opener: HTMLElement) => void;
  /** Starts the DM with someone suggested, or opens the one they have, and goes there, settling with whether it did. */
  onStartDirect: (person: User) => Promise<boolean>;
}

/**
 * The DMs page's list, after Slack's: "Direct messages" over Unreads, which shows only the DMs marked
 * unread, the button that starts a new one, and Find a DM…, which shows only those with someone of that
 * name. Each DM's row has its people's avatars and names, its latest message, "You: …" when it's yours,
 * when it came, and how many are unread, latest active first. People suggested for DMs follow.
 */
export function DirectsPane({ meId, rooms, loaded, previews, suggestions, currentRoomId, unreadOnly, onSelect, onNewDirect, onStartDirect }: Props) {
  const nameOf = useNameOf();
  const [unreadsOn, setUnreadsOn] = useState(false);
  const [typed, setTyped] = useState("");
  const onlyUnread = unreadOnly || unreadsOn;
  const directs = useMemo(() => inDirectOrder(apart(rooms).directs), [rooms]);
  const listed = directs.filter(
    (room) => (!onlyUnread || markedUnread(room, currentRoomId)) && namesMatch(membersShown(room, meId), typed, nameOf),
  );
  const suggested = useMemo(() => (onlyUnread || typed.trim() !== "" ? [] : suggestedPeople(suggestions, rooms)), [onlyUnread, typed, suggestions, rooms]);
  const unreadId = useId();
  const unreadsId = useId();
  const mounted = useMounted();
  const [starting, setStarting] = useState<UserId | null>(null);
  // A suggestion starts its DM once the page's guard lets it, from a page with changes to lose.
  const startWith = (person: User) => {
    if (starting) return;
    leave(async () => {
      setStarting(person.id);
      try {
        return await onStartDirect(person);
      } finally {
        if (mounted.current) setStarting(null);
      }
    });
  };
  // A row followed in place shows its DM beside the list, and one opened elsewhere, as in a new tab, leaves this page be.
  const select = (event: MouseEvent, roomId: RoomId) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(roomId);
  };
  const empty = loaded && listed.length === 0 && suggested.length === 0;
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-none flex-col gap-2.5 px-3 pt-4 pb-2.5 max-md:pr-12">
        <div className="flex min-h-8 items-center gap-2 px-1.5">
          <h2 className="min-w-0 flex-1 truncate text-[17px] leading-6 font-[650]">Direct messages</h2>
          <label htmlFor={unreadsId} className="text-[13px] text-muted-foreground">
            Unreads
          </label>
          <UnreadsSwitch id={unreadsId} on={onlyUnread} disabled={unreadOnly} onChange={setUnreadsOn} />
          <a
            href={NEW_DIRECT_PATH}
            title="New direct message"
            aria-label="New direct message"
            onClick={opensNewDirect(onNewDirect)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-hover touch:size-11"
          >
            <ChatPlusIn className="size-[18px]" />
          </a>
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Find a DM…"
            aria-label="Find a DM"
            className="h-8 w-full rounded-lg border bg-background pr-2.5 pl-8 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:border-ring touch:h-11 max-md:text-base"
          />
        </div>
      </div>
      <span id={unreadId} hidden>
        Unread
      </span>
      <section aria-label="Direct messages" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable]">
        <ul className="flex flex-col">
          {listed.map((room) => (
            <li key={room.id} className="border-b last:border-b-0">
              <DirectRow
                room={room}
                meId={meId}
                preview={previews.get(room.id) ?? null}
                current={room.id === currentRoomId}
                unreadId={markedUnread(room, currentRoomId) ? unreadId : null}
                onClick={(event) => select(event, room.id)}
              />
            </li>
          ))}
        </ul>
        {suggested.length > 0 && (
          <div className="flex flex-col gap-[3px] px-3 pt-3">
            <h3 className="px-[9px] pb-1 text-xs font-medium text-muted-foreground">Start a conversation</h3>
            {suggested.map((person) => (
              <SuggestionRow key={person.id} person={person} starting={person.id === starting} onClick={() => startWith(person)} />
            ))}
          </div>
        )}
        {empty && (
          <p className="px-[21px] pt-3 text-[13px] text-muted-foreground">
            {onlyUnread ? "You’re all caught up. No unread direct messages." : typed.trim() ? "No DMs with anyone by that name." : "No direct messages yet."}
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * The DMs page with no DM open: beside the list, a chat bubble, faded, saying to pick one, or at 900px
 * and below, where the list is in the drawer, the list itself, `list`.
 */
export function DirectsHome({ list }: { list: ReactNode }) {
  useTitle("Direct messages");
  const drawerLayout = useMediaQuery(DRAWER_LAYOUT);
  if (drawerLayout)
    return (
      <>
        <PageHeader>
          <h1 className="min-w-0 flex-1 truncate text-base font-[650]">Direct messages</h1>
        </PageHeader>
        <MainContent className="flex min-h-0 min-w-0 flex-col bg-surface pl-[env(safe-area-inset-left)]">{list}</MainContent>
      </>
    );
  return (
    <MainContent className="col-start-3 row-span-2 grid min-h-0 min-w-0 place-content-center justify-items-center gap-2 bg-background p-6 text-center text-muted-foreground">
      <ChatBubbleEmpty className="mb-2 h-auto w-24 text-foreground opacity-20" />
      <h1 className="text-xl font-bold text-foreground">Your direct messages</h1>
      <p>Pick a conversation from the list, or start a new one.</p>
    </MainContent>
  );
}

interface DirectRowProps {
  room: DirectSidebarRoom;
  meId: UserId;
  preview: DirectPreview | null;
  /** Whether it's the DM the tab shows. */
  current: boolean;
  /** The element saying the DM is unread, when it's marked so, or null. */
  unreadId: string | null;
  onClick: (event: MouseEvent) => void;
}

/**
 * A DM's row: the other person's avatar, or up to four of a group's, then their names, or yours in a DM
 * with yourself, with the agent badge in a DM with an AI agent alone, when it was last active, its latest
 * message, and how many are unread, or a dot when it's marked unread before that's known.
 */
function DirectRow({ room, meId, preview, current, unreadId, onClick }: DirectRowProps) {
  const nameOf = useNameOf();
  const isWithAgent = useIsWithAgent();
  const members = membersShown(room, meId);
  const latest = preview?.latest ?? null;
  const at = new Date(latest?.createdAt ?? room.activeAt);
  const unread = unreadId !== null;
  const count = unread ? (preview?.unread ?? 0) : 0;
  // Named for whom it's with, and described by whether it's unread, how many, when, and what was said last.
  const nameId = useId();
  const aboutId = useId();
  return (
    <a
      href={roomPath(room.id)}
      aria-current={current ? "page" : undefined}
      aria-labelledby={nameId}
      aria-describedby={unreadId ? `${unreadId} ${aboutId}` : aboutId}
      onClick={onClick}
      className="flex min-h-[72px] items-start gap-3 px-[18px] py-3 text-foreground no-underline hover:bg-hover aria-[current=page]:bg-hover"
    >
      {members.length > 1 ? (
        <span aria-hidden="true" className="grid size-9 shrink-0 grid-cols-2 place-content-center gap-px">
          {members.slice(0, MAX_FACES).map((member) => (
            <UserAvatar key={member.id} user={member} square className="size-[17px] rounded-[4px]" />
          ))}
        </span>
      ) : (
        members.map((member) => <UserAvatar key={member.id} user={member} square className="size-9" />)
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          {/* The space after the hidden words starts the visible line, where it doesn't show. */}
          <span id={nameId} className={cn("min-w-0 flex-1 truncate text-[15px] leading-[22px]", unread ? "font-[750]" : "font-semibold")}>
            <span className="sr-only">Direct message with</span> {members.map((member) => `${nameOf(member)}${member.id === meId ? " (you)" : ""}`).join(", ")}
            {isWithAgent(room) && <AgentBadge className="ms-0.5" />}
          </span>
          {count > 0 && (
            <span className="order-last inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center self-center rounded-full bg-foreground px-1.5 text-[11px] leading-none font-semibold text-background">
              {unreadBadge(count)}
            </span>
          )}
          {unread && count === 0 && <span aria-hidden="true" className="order-last size-[7px] shrink-0 self-center rounded-full bg-foreground" />}
          <time dateTime={at.toISOString()} className="shrink-0 text-[12px] text-muted-foreground">
            {activityLabel(at)}
          </time>
        </span>
        {/* What screen readers hear after the name: how many are unread, when, and what was said. */}
        <span id={aboutId} className="sr-only">
          {[count > 0 && `${unreadBadge(count)} unread`, activityLabel(at), latest && previewOf(latest, meId, members.length > 1, nameOf)].filter(Boolean).join(", ")}
        </span>
        {latest && (
          <span aria-hidden="true" className={cn("line-clamp-2 text-[14px] leading-5 wrap-anywhere", unread ? "text-foreground" : "text-muted-foreground")}>
            {previewOf(latest, meId, members.length > 1, nameOf)}
          </span>
        )}
      </span>
    </a>
  );
}

/**
 * Unreads' switch, drawn as the switch in ui/switch.tsx draws Campfire's `.switch`, at 11px, but a plain
 * button, so the list, which loads with the app, doesn't bring Radix's switch with it.
 */
function UnreadsSwitch({ id, on, disabled, onChange }: { id: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-[1.75em] w-[3em] shrink-0 cursor-pointer rounded-[2em] bg-muted-foreground text-[11px] transition duration-150 ease-in-out aria-checked:bg-foreground disabled:cursor-not-allowed [@media(any-hover:hover)]:[&:not(:active):hover]:brightness-[0.7]"
    >
      <span
        aria-hidden="true"
        className={cn("pointer-events-none absolute bottom-[0.2em] left-[0.2em] block size-[1.35em] rounded-full bg-background transition duration-150 ease-in-out", on && "translate-x-[1.2em]")}
      />
    </button>
  );
}

interface SuggestionRowProps {
  person: User;
  /** Whether the DM with them is starting, which another click doesn't start again. */
  starting: boolean;
  onClick: () => void;
}

/** Someone suggested for a DM: a button with their avatar and name, which starts the DM with them. */
function SuggestionRow({ person, starting, onClick }: SuggestionRowProps) {
  const nameOf = useNameOf();
  return (
    <button
      type="button"
      aria-disabled={starting || undefined}
      onClick={onClick}
      className="flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-[9px] py-[7px] text-start text-sm text-foreground hover:bg-hover aria-disabled:cursor-default touch:min-h-11"
    >
      <UserAvatar user={person} square className="size-6" />
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Start a direct message with</span> {nameOf(person)}
      </span>
    </button>
  );
}
