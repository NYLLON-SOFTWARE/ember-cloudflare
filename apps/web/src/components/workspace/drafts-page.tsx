import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type Ref } from "react";
import type { ListedScheduledMessage, Me, Room, ScheduledMessage, SearchMatch } from "@ember/protocol";
import { writtenBody } from "@ember/richtext/dom";
import { useOptionalFlash } from "@/components/flash";
import { Clock, EditPencil, Trash } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { useLongPress } from "@/components/mobile/use-long-press";
import { PageLink } from "@/components/page-link";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { DRAFTS_PATH, permalinkOf, roomPath, SCHEDULED_PATH, SENT_PATH, threadPath } from "@/hooks/use-route";
import { useAllScheduled } from "@/hooks/use-scheduled";
import { useTitle } from "@/hooks/use-title";
import { fetchScheduled, fetchSearch, isSignedOut } from "@/lib/api";
import { discardDraft, draftsOf, type Draft } from "@/lib/drafts";
import { dateTimeLabel, timeLabel } from "@/lib/messages";
import { activityLabel } from "@/lib/direct-list";
import { changeScheduled, type ScheduledChange } from "@/lib/scheduled-actions";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";
import { UNDO_MS } from "./schedule-send";
import { ScheduledSheet } from "./scheduled-list";
import { RoomMark, useSearchNames, type SearchNames } from "./search-box";
import { TimeDialog } from "./time-dialog";

/** A `.btn` under the list, 44px tall for fingers. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium hover:bg-hover touch:min-h-11";

const TABS = [
  { tab: "drafts", label: "Drafts", href: DRAFTS_PATH },
  { tab: "scheduled", label: "Scheduled", href: SCHEDULED_PATH },
  { tab: "sent", label: "Sent", href: SENT_PATH },
] as const;

interface Props {
  me: Me;
  tab: "drafts" | "scheduled" | "sent";
  /** The rooms the sidebar lists, which drafts and messages are named by. */
  rooms: readonly Room[];
  /** Says why loading failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * Drafts & sent, after Slack's: Drafts lists what you've written in your rooms and threads and not sent,
 * which this browser keeps, each opening where it was written, and Sent the messages you've sent lately,
 * newest first, with their rooms, each opening where it is.
 */
export function DraftsPage({ me, tab, rooms, onFailed }: Props) {
  const names = useSearchNames(me, rooms);
  useTitle(TABS.find((shown) => shown.tab === tab)!.label);
  return (
    <>
      <PageHeader>
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">Drafts &amp; sent</h1>
      </PageHeader>
      <MainContent className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        <nav aria-label="Drafts and sent" className="flex flex-none gap-1 border-b px-[22px] max-md:px-3">
          {TABS.map(({ tab: shown, label, href }) => (
            <PageLink
              key={shown}
              href={href}
              replace
              aria-current={tab === shown ? "page" : undefined}
              className="-mb-px border-b-2 border-transparent px-2.5 py-2.5 text-[14px] font-medium text-muted-foreground hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:text-foreground touch:min-h-11"
            >
              {label}
            </PageLink>
          ))}
        </nav>
        <section className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-contain px-[22px] pt-4 pb-[max(18px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] max-md:px-0 max-md:pt-3">
          {tab === "drafts" ? <Drafts me={me} names={names} /> : tab === "scheduled" ? <Scheduled names={names} onFailed={onFailed} /> : <Sent me={me} names={names} onFailed={onFailed} />}
        </section>
      </MainContent>
    </>
  );
}

/** Your drafts in the rooms you're still in, each with its room and its text, opening where it was written, with a button that discards it. */
function Drafts({ me, names }: { me: Me; names: SearchNames }) {
  const [drafts, setDrafts] = useState(() => draftsOf(me.id));
  const shown = useMemo(
    () => drafts.flatMap((draft) => {
      const room = names.room(draft.roomId);
      const text = writtenBody(draft.body).plainText.trim();
      return room && text ? [{ draft, room, text }] : [];
    }),
    [drafts, names],
  );
  const discard = (draft: Draft) => {
    discardDraft(draft);
    setDrafts((drafts) => drafts.filter((d) => d.key !== draft.key));
  };
  if (shown.length === 0) return <Nothing title="No drafts" />;
  return (
    <ul className="flex flex-col">
      {shown.map(({ draft, room, text }) => (
        <li key={draft.key}>
          <ItemRow
            room={room}
            roomName={names.roomName(room)}
            threadReply={draft.threadId !== undefined}
            href={draft.threadId ? threadPath(room.id, draft.threadId) : roomPath(room.id)}
            text={text}
            action={
              <button
                type="button"
                title="Delete draft"
                aria-label={`Delete draft in ${names.roomName(room)}`}
                onClick={() => discard(draft)}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground opacity-0 group-hover/item:opacity-100 hover:bg-hover hover:text-foreground focus-visible:opacity-100 touch:size-11 touch:opacity-100"
              >
                <Trash className="size-[18px]" />
              </button>
            }
          />
        </li>
      ))}
    </ul>
  );
}

interface ItemRowProps {
  room: Room | null;
  roomName: string;
  /** Whether it's a reply in one of the room's threads. */
  threadReply: boolean;
  href: string;
  /** When it was sent, if it was, or is to be. */
  at?: Date;
  /** How that's said, when it's sent: its day, and its time after any day but today. */
  atLabel?: string;
  text: string;
  /** What the row offers besides opening it, shown on hover, and always on touch screens. */
  action?: ReactNode;
  /** What it offers over its end, placed by itself. */
  overlay?: ReactNode;
  rowRef?: Ref<HTMLDivElement>;
}

/**
 * A draft's or a sent message's row, as the DMs page's rows are: its room's mark, the room's name in bold
 * and "· Thread reply" for a reply, when it was sent at the right edge, and a line or two of what it
 * says, the whole row opening where it is.
 */
function ItemRow({ room, roomName, threadReply, href, at, atLabel = at && sentLabel(at), text, action, overlay, rowRef }: ItemRowProps) {
  return (
    <div ref={rowRef} className="group/item relative flex items-start hover:bg-hover">
      <PageLink
        href={href}
        className="flex min-w-0 flex-1 items-start gap-3 px-[18px] py-3 text-foreground no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset max-md:px-4"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[6px] bg-surface text-muted-foreground">
          <RoomMark room={room} size={18} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] leading-[22px]">
              <span className="font-semibold">{roomName}</span>
              {threadReply && <span className="text-[13px] text-muted-foreground"> · Thread reply</span>}
            </span>
            {at && (
              <time dateTime={at.toISOString()} title={dateTimeLabel(at)} className="shrink-0 text-[12px] text-muted-foreground">
                {atLabel}
              </time>
            )}
          </span>
          <span className="line-clamp-2 text-[14px] leading-5 wrap-anywhere text-muted-foreground">{text}</span>
        </span>
      </PageLink>
      {action && <span className="self-center pr-3">{action}</span>}
      {overlay}
    </div>
  );
}

/** How long after a room says your scheduled messages changed they're asked for again, as the list trails the room. */
export const SCHEDULED_DELAY_MS = 1000;

/** What's said when a change to a scheduled message from here doesn't go. */
export const SCHEDULED_CHANGE_FAILED = "Couldn't change the scheduled message. Try again.";

/** One deleted from here, which keeps its place with Undo while it can be scheduled again. */
interface Deleted {
  row: ListedScheduledMessage;
  /** As the room had it, which Undo schedules again. */
  message: ScheduledMessage;
}

/**
 * What you've scheduled to send later, in every room you're in, soonest first, as GET /api/scheduled lists
 * it: each with when it's to go, or that it couldn't, opening where it is to go. Each can be sent now, moved
 * or deleted from here, over a socket to its room (`changeScheduled`): on hover or focus, or on a phone, from
 * the sheet a long press opens, as the composer's list has them, and a deletion can be undone for a few
 * seconds. It's asked for as the tab opens, and again a moment after a room open here says your scheduled
 * messages there have changed, or a change made here has gone.
 */
function Scheduled({ names, onFailed }: { names: SearchNames; onFailed: (error: unknown) => void }) {
  const [listed, setListed] = useState<ListedScheduledMessage[] | null>(null);
  // What the rooms open here say of your scheduled messages, which changes as you schedule, send or delete one.
  const heard = useAllScheduled();
  // Bumped once a change made here has gone, which the list trails as it does a room's.
  const [changed, setChanged] = useState(0);
  const [changing, setChanging] = useState<ReadonlySet<string>>(new Set());
  const [moving, setMoving] = useState<ListedScheduledMessage | null>(null);
  const [acting, setActing] = useState<ListedScheduledMessage | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const flash = useOptionalFlash();
  const first = useRef(true);
  useEffect(() => {
    let stopped = false;
    const ask = setTimeout(
      () =>
        fetchScheduled().then(
          (messages) => !stopped && setListed(messages),
          (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
        ),
      first.current ? 0 : SCHEDULED_DELAY_MS,
    );
    first.current = false;
    return () => {
      stopped = true;
      clearTimeout(ask);
    };
  }, [heard, changed, onFailed]);
  useEffect(() => {
    if (!deleted) return;
    // Focus stays where the message's Delete was, on Undo.
    list.current?.querySelector<HTMLElement>("[data-undo]")?.focus();
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted]);

  const change = async (row: ListedScheduledMessage, what: ScheduledChange, made: (message: ScheduledMessage) => void) => {
    setChanging((ids) => new Set(ids).add(row.id));
    const before = await changeScheduled(row.roomId, what);
    setChanging((ids) => new Set([...ids].filter((id) => id !== row.id)));
    if (!before) {
      flash?.("alert", SCHEDULED_CHANGE_FAILED);
      return;
    }
    made(before);
    setChanged((times) => times + 1);
  };
  const without = (row: ListedScheduledMessage) => setListed((rows) => rows && rows.filter(({ id }) => id !== row.id));
  const sendNow = (row: ListedScheduledMessage) => change(row, { type: "send", id: row.id }, () => without(row));
  const move = (row: ListedScheduledMessage, at: Date) =>
    change(row, { type: "move", id: row.id, sendAt: at.getTime() }, () =>
      setListed((rows) => rows && rows.map((listedRow) => (listedRow.id === row.id ? { ...listedRow, sendAt: at.getTime() } : listedRow)).sort(bySendAt)),
    );
  const remove = (row: ListedScheduledMessage) =>
    change(row, { type: "delete", id: row.id }, (message) => {
      without(row);
      // One that couldn't be sent is gone for good, as the composer's list has it.
      if (row.failed === undefined) setDeleted({ row, message });
    });
  const undo = ({ row, message }: Deleted) => {
    setDeleted(null);
    void change(row, { type: "restore", message }, () => setListed((rows) => rows && [...rows, row].sort(bySendAt)));
  };

  // The deleted one keeps its place in the list while it can be brought back.
  const rows = useMemo(() => {
    const all = deleted && !listed?.some(({ id }) => id === deleted.row.id) ? [...(listed ?? []), deleted.row].sort(bySendAt) : (listed ?? []);
    return all.flatMap((message) => {
      const room = names.room(message.roomId);
      return room ? [{ room, message }] : [];
    });
  }, [listed, deleted, names]);
  if (!listed) return <RowsLoading />;
  if (rows.length === 0) return <Nothing title="Nothing scheduled" icon={Clock} />;
  return (
    <>
      <ul ref={list} className="flex flex-col">
        {rows.map(({ room, message }) => (
          <li key={message.id}>
            {message.id === deleted?.row.id ? (
              <p className="flex min-h-[68px] items-center gap-1.5 px-[18px] text-[13px] text-muted-foreground max-md:px-4 max-md:text-[15px]">
                <span role="status">Scheduled message deleted</span>
                <button
                  type="button"
                  data-undo
                  onClick={() => undo(deleted)}
                  className="inline-flex shrink-0 cursor-pointer items-center justify-center font-medium text-link hover:underline touch:min-h-11 touch:min-w-11"
                >
                  Undo
                </button>
              </p>
            ) : (
              <ScheduledRow
                room={room}
                roomName={names.roomName(room)}
                message={message}
                disabled={changing.has(message.id)}
                onSendNow={() => sendNow(message)}
                onMove={() => setMoving(message)}
                onRemove={() => remove(message)}
                onPress={() => setActing(message)}
              />
            )}
          </li>
        ))}
      </ul>
      {acting && (
        <ScheduledSheet
          text={acting.preview}
          failed={acting.failed !== undefined}
          onClose={() => setActing(null)}
          onSendNow={() => sendNow(acting)}
          onMove={() => setMoving(acting)}
          onRemove={() => remove(acting)}
        />
      )}
      {moving && (
        <TimeDialog
          title="Edit time"
          action="Save"
          initial={new Date(moving.sendAt)}
          onClose={() => setMoving(null)}
          onPick={(at) => {
            setMoving(null);
            void move(moving, at);
          }}
        />
      )}
    </>
  );
}

const bySendAt = (a: ListedScheduledMessage, b: ListedScheduledMessage) => a.sendAt - b.sendAt || (a.id < b.id ? -1 : 1);

/** Where a scheduled message's actions are pressed for rather than shown: phones and touch screens. */
const PRESSED_FOR_ACTIONS = "(width < 48rem), (pointer: coarse)";

interface ScheduledRowProps {
  room: Room;
  roomName: string;
  message: ListedScheduledMessage;
  /** While a change to it is on its way. */
  disabled: boolean;
  onSendNow: () => void;
  onMove: () => void;
  onRemove: () => void;
  /** A finger's long press, which opens the sheet of what can be done with it. */
  onPress: () => void;
}

/**
 * A scheduled message's row, which opens where it's to go, with Edit time, Send now and Delete over its end
 * on hover or focus, but for one that couldn't be sent, which can't be moved. A finger presses it long for them.
 */
function ScheduledRow({ room, roomName, message, disabled, onSendNow, onMove, onRemove, onPress }: ScheduledRowProps) {
  const row = useRef<HTMLDivElement>(null);
  // Only where the actions don't show, so a mouse's right click keeps the browser's menu for the link.
  const pressable = useMediaQuery(PRESSED_FOR_ACTIONS);
  useLongPress(row, onPress, pressable && !disabled);
  const action = "inline-flex h-8 cursor-pointer items-center rounded-lg px-2.5 text-[13px] font-medium hover:bg-hover disabled:pointer-events-none disabled:opacity-50";
  return (
    <ItemRow
      rowRef={row}
      room={room}
      roomName={roomName}
      threadReply={message.parentId !== undefined}
      href={message.parentId ? threadPath(room.id, message.parentId) : roomPath(room.id)}
      at={new Date(message.sendAt)}
      atLabel={message.failed ? "Not sent" : scheduledLabel(new Date(message.sendAt))}
      text={message.preview}
      overlay={
        <span className="pointer-events-none absolute top-1/2 right-3 flex -translate-y-1/2 gap-0.5 rounded-[10px] border bg-background p-0.5 opacity-0 shadow-sm group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100 group-hover/item:pointer-events-auto group-hover/item:opacity-100 max-md:hidden pointer-coarse:hidden">
          {message.failed === undefined && (
            <button type="button" disabled={disabled} onClick={onMove} className={action}>
              Edit time
            </button>
          )}
          <button type="button" disabled={disabled} onClick={onSendNow} className={action}>
            Send now
          </button>
          <button type="button" disabled={disabled} onClick={onRemove} className={cn(action, "text-negative")}>
            Delete
          </button>
        </span>
      }
    />
  );
}

/** What Sent has loaded: your messages, newest first, the cursor of the next page, and the rooms they're in. */
interface SentPage {
  matches: SearchMatch[];
  next: number | null;
  rooms: ReadonlyMap<string, Room>;
}

/** Your messages, newest first, as search finds them, each with its room and time, opening where it is, with Show more while there are more. */
function Sent({ me, names, onFailed }: { me: Me; names: SearchNames; onFailed: (error: unknown) => void }) {
  const [page, setPage] = useState<SentPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useMounted();
  const search = useMemo(() => ({ q: "", from: me.id }), [me.id]);
  useEffect(() => {
    let stopped = false;
    fetchSearch(search).then(
      (results) => !stopped && setPage({ matches: results.matches, next: results.next, rooms: new Map(results.rooms.map((room) => [room.id, room])) }),
      (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [search, onFailed]);
  const showMore = () => {
    if (!page || page.next === null || loadingMore) return;
    setLoadingMore(true);
    fetchSearch(search, "newest", page.next).then(
      (results) => {
        if (!mounted.current) return;
        setLoadingMore(false);
        setPage((page) => {
          if (!page) return page;
          const shown = new Set(page.matches.map(({ message }) => message.id));
          return {
            matches: [...page.matches, ...results.matches.filter(({ message }) => !shown.has(message.id))],
            next: results.next,
            rooms: new Map([...page.rooms, ...results.rooms.map((room) => [room.id, room] as const)]),
          };
        });
      },
      (error: unknown) => {
        if (mounted.current) setLoadingMore(false);
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };
  if (!page) return <RowsLoading />;
  if (page.matches.length === 0) return <Nothing title="Nothing sent yet" />;
  return (
    <>
      <ol className="flex flex-col">
        {page.matches.map(({ message }) => {
          const room = page.rooms.get(message.roomId) ?? names.room(message.roomId);
          return (
            <li key={message.id}>
              <ItemRow
                room={room}
                roomName={room ? names.roomName(room) : "A room you’ve left"}
                threadReply={message.parentId !== undefined}
                href={permalinkOf(message)}
                at={new Date(message.createdAt)}
                text={message.plainText.replace(/\s+/g, " ").trim()}
              />
            </li>
          );
        })}
      </ol>
      {page.next !== null && (
        <div className="flex justify-center pt-4">
          <button type="button" onClick={showMore} aria-busy={loadingMore || undefined} className={BUTTON}>
            {loadingMore ? "Loading…" : "Show more"}
          </button>
        </div>
      )}
    </>
  );
}

/** Sent loading: the shapes of a few rows, faint, for screen readers Loading…. */
function RowsLoading() {
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">Loading…</span>
      {[0, 1, 2].map((row) => (
        <div key={row} aria-hidden="true" className="flex min-h-[68px] gap-3 px-[18px] py-3 max-md:px-4">
          <span className="size-9 shrink-0 rounded-[6px] bg-hover" />
          <span className="flex flex-1 flex-col gap-2 pt-1">
            <span className="h-3 w-1/3 rounded-full bg-hover" />
            <span className="h-3 w-3/4 rounded-full bg-hover" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** When a message was sent: its day, as the DMs page dates a DM, with its time after any day but today. */
function sentLabel(date: Date): string {
  const day = activityLabel(date);
  const time = timeLabel(date);
  return day === time ? time : `${day} at ${time}`;
}

const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * When a scheduled message is to go: its time today, "Tomorrow at" its time, its weekday within the week
 * ahead, and else its date.
 */
export function scheduledLabel(date: Date, now = new Date()): string {
  const time = timeLabel(date);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const weekAhead = new Date(now);
  weekAhead.setDate(now.getDate() + 7);
  if (date.toDateString() === now.toDateString()) return time;
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
  return `${(date < weekAhead ? weekdayFormat : monthDayFormat).format(date)} at ${time}`;
}

/** What a tab says when it has nothing to list, under a faded pencil: its title alone. */
function Nothing({ title, icon: Icon = EditPencil }: { title: string; icon?: ComponentType<{ className?: string }> }) {
  return (
    <div className={cn("grid justify-items-center px-6 pt-[8dvh] pb-6 text-center text-muted-foreground")}>
      <Icon className="mb-4 h-auto w-16 max-w-[25vw] text-foreground opacity-20" />
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
    </div>
  );
}
