import { useEffect, useMemo, useState } from "react";
import type { Me, Room, SearchMatch } from "@ember/protocol";
import { writtenBody } from "@ember/richtext/dom";
import { EditPencil, NavArrowRight, Trash } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { useMounted } from "@/hooks/use-mounted";
import { DRAFTS_PATH, permalinkOf, roomPath, SENT_PATH, threadPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { fetchSearch, isSignedOut } from "@/lib/api";
import { discardDraft, draftsOf, type Draft } from "@/lib/drafts";
import { dateTimeLabel, timeLabel } from "@/lib/messages";
import { activityLabel } from "@/lib/direct-list";
import { cn } from "@/lib/utils";
import { MessageItem, type MessageEditors } from "./message-item";
import { PageHeader } from "./page-header";
import { RoomMark, useSearchNames, type SearchNames } from "./search-box";

/** Sent messages can't be edited or replied to here, so nothing opens an editor or writes in a composer. */
const NO_EDITORS: MessageEditors = { open() {}, close() {}, returnFocus() {}, attach() {}, reply() {} };

/** A `.btn` under the list, 44px tall for fingers. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium hover:bg-hover touch:min-h-11";

const TABS = [
  { tab: "drafts", label: "Drafts", href: DRAFTS_PATH },
  { tab: "sent", label: "Sent", href: SENT_PATH },
] as const;

interface Props {
  me: Me;
  tab: "drafts" | "sent";
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
  useTitle(tab === "drafts" ? "Drafts" : "Sent");
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
        <section className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-contain px-[22px] pt-4 pb-[max(18px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] max-md:px-3 max-md:pt-3">
          {tab === "drafts" ? <Drafts me={me} names={names} /> : <Sent me={me} names={names} onFailed={onFailed} />}
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
    <ul className="flex flex-col gap-3">
      {shown.map(({ draft, room, text }) => (
        <li key={draft.key} className="flex items-start gap-3 rounded-xl border bg-background px-4 py-3 max-md:px-3">
          <PageLink href={draft.threadId ? threadPath(room.id, draft.threadId) : roomPath(room.id)} className="flex min-w-0 flex-1 flex-col gap-1 text-foreground no-underline">
            <span className="flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground">
              <RoomMark room={room} size={15} />
              <span className="min-w-0 truncate font-semibold text-foreground">{names.roomName(room)}</span>
              {draft.threadId && <span className="shrink-0">· Thread reply</span>}
            </span>
            <span className="line-clamp-3 text-[15px] leading-[22px] wrap-anywhere">{text}</span>
          </PageLink>
          <button
            type="button"
            title="Delete draft"
            aria-label={`Delete draft in ${names.roomName(room)}`}
            onClick={() => discard(draft)}
            className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-hover hover:text-foreground touch:size-11"
          >
            <Trash className="size-[18px]" />
          </button>
        </li>
      ))}
    </ul>
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
  if (!page) return <p className="py-10 text-center text-muted-foreground">Loading…</p>;
  if (page.matches.length === 0) return <Nothing title="Nothing sent yet" />;
  return (
    <>
      <ol className="flex flex-col gap-3">
        {page.matches.map(({ message }) => {
          const room = page.rooms.get(message.roomId) ?? names.room(message.roomId);
          const created = new Date(message.createdAt);
          return (
            <li key={message.id} className="overflow-hidden rounded-xl border bg-background">
              <div className="flex min-h-9 items-center gap-2 border-b bg-surface px-4 py-1.5 text-[13px] text-muted-foreground max-md:px-3">
                <RoomMark room={room} size={15} />
                <span className="min-w-0 truncate font-semibold text-foreground">{room ? names.roomName(room) : "A room you’ve left"}</span>
                {message.parentId !== undefined && <span className="shrink-0">· Thread reply</span>}
                <span aria-hidden>·</span>
                <time dateTime={message.createdAt} title={dateTimeLabel(created)} className="shrink-0">
                  {sentLabel(created)}
                </time>
                <PageLink
                  href={permalinkOf(message)}
                  className="ml-auto inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium hover:bg-hover hover:text-foreground touch:min-h-11 touch:min-w-11"
                >
                  <span className="max-md:sr-only">Open</span>
                  <NavArrowRight className="size-4" />
                </PageLink>
              </div>
              <div className="pb-1">
                <MessageItem message={message} me={me} threaded={false} editing={false} actions={null} editors={NO_EDITORS} />
              </div>
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

/** When a message was sent: its day, as the DMs page dates a DM, with its time after any day but today. */
function sentLabel(date: Date): string {
  const day = activityLabel(date);
  const time = timeLabel(date);
  return day === time ? time : `${day} at ${time}`;
}

/** What a tab says when it has nothing to list, under a faded pencil: its title alone. */
function Nothing({ title }: { title: string }) {
  return (
    <div className={cn("grid justify-items-center px-6 pt-[8dvh] pb-6 text-center text-muted-foreground")}>
      <EditPencil className="mb-4 h-auto w-16 max-w-[25vw] text-foreground opacity-20" />
      <h2 className="text-xl font-bold text-foreground">{title}</h2>
    </div>
  );
}
