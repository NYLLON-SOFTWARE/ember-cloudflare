import { createContext, useContext, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { DirectPreview, RoomId, SidebarRoom, User, UserId } from "@ember/protocol";
import { ChatBubbleEmpty, ChatPlusIn, CheckCircle, Search, Xmark } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { useDirectPreviews } from "@/hooks/use-direct-previews";
import { useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { dmPath, leave, NEW_DIRECT_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { activityLabel, namesMatch, previewOf, unreadBadge } from "@/lib/direct-list";
import { membersShown } from "@/lib/directs";
import { apart, inDirectOrder, markedUnread, suggestedPeople, type DirectSidebarRoom } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { AgentBadge, useIsWithAgent } from "./agent-badge";
import { DirectAvatars } from "./direct-avatars";
import { ListEmptyState } from "./list-empty-state";
import { opensNewDirect } from "./new-direct-dialog";
import { PageHeader } from "./page-header";
import { UnreadsSwitch } from "./unreads-switch";
import { UserAvatar } from "./user-avatar";

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
 * The DMs page's list, with each DM's latest message and how many are unread, which it asks for while
 * it's shown (`useDirectPreviews`), so that loads with it. `onSignedOut` hears of a session that's ended.
 */
export function DirectsColumn({ onSignedOut, ...props }: Omit<Props, "previews"> & { onSignedOut: () => void }) {
  const previews = useDirectPreviews(props.loaded ? props.rooms : null, true, onSignedOut);
  return <DirectsPane {...props} previews={previews} />;
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
  const findRef = useRef<HTMLInputElement>(null);
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
  const titled = useContext(DirectsTitleContext);
  const compose = (
    <a
      href={NEW_DIRECT_PATH}
      title="New direct message"
      aria-label="New direct message"
      onClick={opensNewDirect(onNewDirect)}
      className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-hover touch:size-11"
    >
      <ChatPlusIn className="size-[18px]" />
    </a>
  );
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-none flex-col gap-2.5 px-3 pt-4 pb-2.5">
        {/* Between 768px and 900px the drawer's close button sits at the end of this row, which keeps clear of it.
            Where the page titles itself and has a New direct message of its own, phones have neither here. */}
        <div className={cn("flex min-h-8 items-center gap-2 px-1.5 md:max-[56.3125rem]:pr-10", !titled && "max-md:hidden")}>
          <h2 className={cn("min-w-0 flex-1 truncate text-[17px] leading-6 font-[650]", !titled && "sr-only")}>Direct messages</h2>
          {/* Beside the page, Unreads is a chip, as Activity's is; on phones, All and Unreads are chips under Find a DM…. */}
          <span className="contents max-md:hidden">
            <UnreadsSwitch on={onlyUnread} disabled={unreadOnly} onChange={setUnreadsOn} />
          </span>
          {compose}
        </div>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          {/* The browser's own clear button is drawn in its own blue, so the field draws its own. */}
          <input
            ref={findRef}
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="Find a DM…"
            aria-label="Find a DM"
            className="h-8 w-full rounded-lg border bg-background pr-8 pl-8 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:border-ring touch:h-11 touch:text-base max-md:text-base [&::-webkit-search-cancel-button]:appearance-none"
          />
          {typed !== "" && (
            <button
              type="button"
              aria-label="Clear"
              title="Clear"
              onClick={() => {
                setTyped("");
                findRef.current?.focus();
              }}
              className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground touch:size-9"
            >
              <Xmark className="size-4" />
            </button>
          )}
        </div>
        <UnreadsChips on={onlyUnread} disabled={unreadOnly} onChange={setUnreadsOn} />
      </div>
      <span id={unreadId} hidden>
        Unread
      </span>
      <section aria-label="Direct messages" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[max(16px,env(safe-area-inset-bottom))] max-md:pb-[calc(112px+env(safe-area-inset-bottom))] [scrollbar-gutter:stable]">
        <ul className="flex flex-col">
          {listed.map((room) => (
            <li key={room.id}>
              <DirectRow
                room={room}
                meId={meId}
                preview={previews.get(room.id) ?? null}
                previewKnown={previews.has(room.id)}
                current={room.id === currentRoomId}
                unreadId={markedUnread(room, currentRoomId) ? unreadId : null}
                onClick={(event) => select(event, room.id)}
              />
            </li>
          ))}
        </ul>
        {suggested.length > 0 && (
          <div className="flex flex-col pt-3">
            <h3 className="px-[18px] pb-1 text-xs font-medium text-muted-foreground">Start a conversation</h3>
            {suggested.map((person) => (
              <SuggestionRow key={person.id} person={person} starting={person.id === starting} onClick={() => startWith(person)} />
            ))}
          </div>
        )}
        {empty &&
          (typed.trim() ? (
            <ListEmptyState Icon={Search} title="No matches" />
          ) : onlyUnread ? (
            <ListEmptyState Icon={CheckCircle} title="You’re all caught up" />
          ) : (
            <ListEmptyState Icon={ChatBubbleEmpty} title="No direct messages yet" />
          ))}
      </section>
    </div>
  );
}

/**
 * Whether the DMs list heads itself "Direct messages", with New direct message beside it, or leaves both
 * to the page around it on phones, as a phone's header and its compose button have them, keeping only the
 * title, for screen readers.
 */
export const DirectsTitleContext = createContext(true);

/** How many DMs someone has, and how many of them are unread, as the DMs page says with none open. */
export const directsSummary = (conversations: number, unread: number) =>
  [`${conversations} ${conversations === 1 ? "conversation" : "conversations"}`, unread > 0 && `${unread} unread`].filter(Boolean).join(" · ");

interface DirectsHomeProps {
  list: ReactNode;
  /** Opens New direct message, from the button that opened it, which the page's header has on phones. */
  onNewDirect: (opener: HTMLElement) => void;
  /** How many DMs there are, and how many are unread, or null until the list has come. */
  counts: { conversations: number; unread: number } | null;
}

/**
 * The DMs page with no DM open: beside the list, a faded chat bubble over how many DMs there are and how
 * many are unread, or at 900px and below, where the list is in the drawer, the list itself, `list`, under
 * the page's title and New direct message.
 */
export function DirectsHome({ list, counts, onNewDirect }: DirectsHomeProps) {
  useTitle("Direct messages");
  const drawerLayout = useMediaQuery(DRAWER_LAYOUT);
  if (drawerLayout)
    return (
      <>
        <PageHeader>
          <h1 className="min-w-0 flex-1 truncate text-base font-[650]">Direct messages</h1>
          <a
            href={NEW_DIRECT_PATH}
            title="New direct message"
            aria-label="New direct message"
            onClick={opensNewDirect(onNewDirect)}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-hover"
          >
            <ChatPlusIn className="size-5" />
          </a>
        </PageHeader>
        {/* Clear of a phone's notch and rounded corners on either side, held sideways. */}
        <MainContent className="flex min-h-0 min-w-0 flex-col bg-surface pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          <DirectsTitleContext value={false}>{list}</DirectsTitleContext>
        </MainContent>
      </>
    );
  return (
    <MainContent className="col-start-3 row-span-2 grid min-h-0 min-w-0 place-content-center justify-items-center gap-3 bg-background p-6 text-center text-[13px] text-muted-foreground">
      <h1 className="sr-only">Direct messages</h1>
      <ChatBubbleEmpty aria-hidden="true" className="h-auto w-24 text-foreground opacity-20" />
      {counts && <p>{directsSummary(counts.conversations, counts.unread)}</p>}
    </MainContent>
  );
}

interface DirectRowProps {
  room: DirectSidebarRoom;
  meId: UserId;
  preview: DirectPreview | null;
  /** Whether its preview has come, before which its row keeps a line for it, so it doesn't jump. */
  previewKnown: boolean;
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
function DirectRow({ room, meId, preview, previewKnown, current, unreadId, onClick }: DirectRowProps) {
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
  // How many are unread, or a dot where it's marked unread before that's known.
  const marker =
    count > 0 ? (
      <span
        aria-hidden="true"
        className="mt-px inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] leading-none font-semibold text-background"
      >
        {unreadBadge(count)}
      </span>
    ) : (
      unread && <span aria-hidden="true" className="mt-1.5 size-[7px] shrink-0 self-start rounded-full bg-foreground" />
    );
  return (
    <a
      href={dmPath(room.id)}
      aria-current={current ? "page" : undefined}
      aria-labelledby={nameId}
      aria-describedby={unreadId ? `${unreadId} ${aboutId}` : aboutId}
      onClick={onClick}
      // The ring is inset, so the list's edges, which the row runs to, don't clip it. A DM with nothing
      // said in it yet has its name centered beside the avatar, in a row as tall as the avatar and its
      // padding, once that's known: until its preview comes, a row keeps a faint line for it.
      className={cn(
        "group/row flex gap-3 px-[18px] py-3 text-foreground no-underline outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:bg-hover",
        latest || !previewKnown ? "min-h-[72px] items-start" : "min-h-[60px] items-center",
      )}
    >
      <DirectAvatars members={members} ringClassName="ring-surface group-hover/row:ring-hover group-aria-[current=page]/row:ring-hover" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          {/* The space after the hidden words starts the visible line, where it doesn't show. */}
          <span id={nameId} className={cn("min-w-0 flex-1 truncate text-[15px] leading-[22px]", unread ? "font-[750]" : "font-semibold")}>
            <span className="sr-only">Direct message with</span> {members.map((member) => `${nameOf(member)}${member.id === meId ? " (you)" : ""}`).join(", ")}
            {isWithAgent(room) && <AgentBadge className="ms-0.5" />}
          </span>
          <time dateTime={at.toISOString()} className="shrink-0 text-[12px] text-muted-foreground">
            {activityLabel(at)}
          </time>
          {!latest && marker}
        </span>
        {/* What screen readers hear after the name: how many are unread, when, and what was said. */}
        <span id={aboutId} className="sr-only">
          {[count > 0 && `${unreadBadge(count)} unread`, activityLabel(at), latest && previewOf(latest, meId, members.length > 1, nameOf)].filter(Boolean).join(", ")}
        </span>
        {latest ? (
          // The time keeps the right edge, and how many are unread ends the message's line, as in Slack.
          <span className="flex min-w-0 items-start gap-2">
            {/* Two lines on phones, as Slack's app shows, and one beside the page, so the rows keep one height. */}
            <span aria-hidden="true" className={cn("min-w-0 flex-1 line-clamp-2 text-[14px] leading-5 wrap-anywhere md:line-clamp-1", unread ? "text-foreground" : "text-muted-foreground")}>
              {previewOf(latest, meId, members.length > 1, nameOf)}
            </span>
            {marker}
          </span>
        ) : (
          !previewKnown && <span aria-hidden="true" className="mt-1.5 h-3 w-2/3 rounded-full bg-hover" />
        )}
      </span>
    </a>
  );
}

interface UnreadsChipsProps {
  on: boolean;
  /** Whether it's held on, as Activity holds it. */
  disabled: boolean;
  onChange: (on: boolean) => void;
}

/** All and Unreads, on phones, as chips under Find a DM…, as Slack's app has them, 44px tall for fingers. */
function UnreadsChips({ on, disabled, onChange }: UnreadsChipsProps) {
  const chip =
    "inline-flex min-h-11 cursor-pointer items-center rounded-full border px-4 text-[14px] font-medium text-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background disabled:cursor-not-allowed";
  return (
    <div role="group" aria-label="Show" className="flex gap-2 px-1.5 md:hidden">
      <button type="button" aria-pressed={!on} disabled={disabled} onClick={() => onChange(false)} className={chip}>
        All
      </button>
      <button type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(true)} className={chip}>
        Unreads
      </button>
    </div>
  );
}

interface SuggestionRowProps {
  person: User;
  /** Whether the DM with them is starting, which another click doesn't start again. */
  starting: boolean;
  onClick: () => void;
}

/**
 * Someone suggested for a DM: a button with their avatar and name, which starts the DM with them. Its
 * avatar is centered where a DM's row has its avatar, so its name starts where theirs do.
 */
function SuggestionRow({ person, starting, onClick }: SuggestionRowProps) {
  const nameOf = useNameOf();
  return (
    <button
      type="button"
      aria-disabled={starting || undefined}
      onClick={onClick}
      className="flex min-h-9 w-full cursor-pointer items-center gap-3 px-[18px] py-[7px] text-start text-sm text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-disabled:cursor-default touch:min-h-11"
    >
      <span className="flex w-9 shrink-0 justify-center">
        <UserAvatar user={person} square className="size-6" />
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="sr-only">Start a direct message with</span> {nameOf(person)}
      </span>
    </button>
  );
}
