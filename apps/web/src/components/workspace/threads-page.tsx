import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import { THREAD_CONTEXT, type ListedThread, type Me, type Message, type Room } from "@ember/protocol";
import { bodyFromPlainText, writtenBody } from "@ember/richtext/dom";
import { MultiBubble, NavArrowRight } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { pendingMessage } from "@/hooks/use-room";
import { useMounted } from "@/hooks/use-mounted";
import { threadPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { isSignedOut } from "@/lib/api";
import { fetchThreads } from "@/lib/conversations";
import { timeline } from "@/lib/messages";
import { handOver } from "@/lib/outbox";
import { MessageItem, type MessageEditors, type ThreadPlace } from "./message-item";
import { PageHeader } from "./page-header";
import { RoomMark, useSearchNames, type SearchNames } from "./search-box";

/** Messages here can't be edited, so nothing opens an editor or writes in a composer. */
const NO_EDITORS: MessageEditors = { open() {}, close() {}, returnFocus() {}, attach() {}, reply() {} };

/** A `.btn` under the list, 44px tall for fingers. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium hover:bg-hover touch:min-h-11";

interface Props {
  me: Me;
  /** The rooms the sidebar lists, which threads are named by. */
  rooms: readonly Room[];
  /** Says why loading failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** The threads loaded so far, and the cursor of the next page, or null when there are no more. */
interface Loaded {
  threads: ListedThread[];
  next: number | null;
}

/**
 * Threads: every thread in the rooms and DMs you're in, latest active first, one scrolling list of
 * cards. Each names its room, says whether you follow it or it mentions you, shows its first message and
 * its latest replies, `THREAD_CONTEXT` messages in all, links to the rest, and ends with a box to reply
 * in, whose replies go to the thread at once.
 */
export function ThreadsPage({ me, rooms, onFailed }: Props) {
  const names = useSearchNames(me, rooms);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const mounted = useMounted();
  useTitle("Threads");
  useEffect(() => {
    let stopped = false;
    fetchThreads().then(
      (page) => !stopped && setLoaded(page),
      (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [onFailed]);
  const showMore = () => {
    if (!loaded || loaded.next === null || loadingMore) return;
    setLoadingMore(true);
    fetchThreads(loaded.next).then(
      (page) => {
        if (!mounted.current) return;
        setLoadingMore(false);
        setLoaded((loaded) => {
          if (!loaded) return page;
          const shown = new Set(loaded.threads.map(({ parent }) => parent.id));
          return { threads: [...loaded.threads, ...page.threads.filter(({ parent }) => !shown.has(parent.id))], next: page.next };
        });
      },
      (error: unknown) => {
        if (mounted.current) setLoadingMore(false);
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };
  return (
    <>
      <PageHeader>
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">Threads</h1>
      </PageHeader>
      <MainContent className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] [scrollbar-gutter:stable] max-md:pl-[env(safe-area-inset-left)]">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-[22px] pt-4 pb-[max(18px,env(safe-area-inset-bottom))] max-md:px-3 max-md:pt-3">
          {!loaded ? (
            <p className="py-10 text-center text-muted-foreground">Loading…</p>
          ) : loaded.threads.length === 0 ? (
            <div className="grid justify-items-center px-6 pt-[8dvh] pb-6 text-center text-muted-foreground">
              <MultiBubble className="mb-4 h-auto w-16 max-w-[25vw] text-foreground opacity-20" />
              <h2 className="mb-1.5 text-xl font-bold text-foreground">No threads yet</h2>
              <p>Threads in your rooms and DMs show up here.</p>
            </div>
          ) : (
            <>
              <ol className="flex flex-col gap-4">
                {loaded.threads.map((thread) => (
                  <li key={thread.parent.id}>
                    <ThreadCard thread={thread} me={me} names={names} />
                  </li>
                ))}
              </ol>
              {loaded.next !== null && (
                <div className="flex justify-center">
                  <button type="button" onClick={showMore} aria-busy={loadingMore || undefined} className={BUTTON}>
                    {loadingMore ? "Loading…" : "Show more"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </MainContent>
    </>
  );
}

/** How many replies a card leaves out, as its link to them says. */
const moreRepliesLabel = (count: number) => (count === 1 ? "1 more reply" : `${count} more replies`);

/** What a card's header says of you and its thread: that it mentions you, or that you follow it, or nothing. */
const markOf = ({ mentioned, following }: Pick<ListedThread, "mentioned" | "following">) => (mentioned ? "Mentions you" : following ? "Following" : null);

/**
 * A thread's card: its room, and whether you follow it or it mentions you, over its first message, how
 * many earlier replies it leaves out, and its latest replies, those written here since among them, so it
 * shows `THREAD_CONTEXT` messages at most, and a box to reply in.
 */
function ThreadCard({ thread, me, names }: { thread: ListedThread; me: Me; names: SearchNames }) {
  const room = names.room(thread.roomId);
  // The replies written here, shown at once and sent by the outbox, as a thread closed while its room is
  // away hands over what it couldn't send.
  const [written, setWritten] = useState<Message[]>([]);
  const replies = useMemo(() => [...thread.replies, ...written].slice(-(THREAD_CONTEXT - 1)), [thread, written]);
  const items = useMemo(() => timeline([thread.parent, ...replies]), [thread, replies]);
  const left = thread.count + written.length - replies.length;
  const mark = markOf(thread);
  // As in a thread's panel: no summary of the thread under its first message, nor Reply in thread.
  const place = useMemo<ThreadPlace>(() => ({ roomName: room && room.kind !== "direct" ? room.name : "", direct: room?.kind === "direct" }), [room]);
  const reply = (text: string) => {
    const body = bodyFromPlainText(text);
    const { plainText, mentions } = writtenBody(body);
    const message = { ...pendingMessage(crypto.randomUUID(), thread.roomId, me, body, plainText, mentions, new Date().toISOString()), parentId: thread.parent.id, alsoSent: false, queued: true as const };
    handOver(thread.roomId, [message]);
    setWritten((written) => [...written, message]);
  };
  return (
    <article aria-label={`Thread in ${room ? names.roomName(room) : "a room"}`} className="overflow-hidden rounded-xl border bg-background">
      <header className="flex min-h-10 items-center gap-2 border-b bg-surface px-4 py-2 text-[14px] max-md:px-3">
        <RoomMark room={room} size={16} />
        <h2 className="min-w-0 truncate font-semibold">{room ? names.roomName(room) : "A room you’ve left"}</h2>
        {mark && <span className="shrink-0 rounded-md bg-hover px-1.5 py-px text-xs font-medium text-muted-foreground">{mark}</span>}
        <PageLink
          href={threadPath(thread.roomId, thread.parent.id)}
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[13px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground touch:min-h-11"
        >
          <span className="max-md:sr-only">Open thread</span>
          <NavArrowRight className="size-4" />
        </PageLink>
      </header>
      <div className="flex flex-col pt-1 pb-1">
        {items.map(({ message, threaded }, index) => (
          <div key={message.id}>
            <MessageItem message={message} me={me} threaded={threaded} editing={false} actions={null} editors={NO_EDITORS} thread={place} />
            {index === 0 && left > 0 && (
              <PageLink href={threadPath(thread.roomId, thread.parent.id)} className="ml-[68px] inline-block py-1 text-[13px] font-semibold text-link hover:underline max-md:ml-[58px]">
                {moreRepliesLabel(left)}
              </PageLink>
            )}
          </div>
        ))}
      </div>
      <ReplyBox onReply={reply} label={`Reply in thread in ${room ? names.roomName(room) : "a room"}`} />
    </article>
  );
}

/** A box to reply in: Enter sends what's written, and Shift+Enter starts a new line. */
function ReplyBox({ onReply, label }: { onReply: (text: string) => void; label: string }) {
  const [text, setText] = useState("");
  const send = () => {
    if (text.trim() === "") return;
    onReply(text.trim());
    setText("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    send();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };
  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t px-4 py-3 max-md:px-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keyDown}
        rows={1}
        placeholder="Reply…"
        aria-label={label}
        className="field-sizing-content max-h-40 min-h-9 flex-1 resize-none rounded-lg border bg-surface px-3 py-1.5 text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground focus-visible:border-ring max-md:text-base"
      />
      <button type="submit" disabled={text.trim() === ""} className={`${BUTTON} min-h-9 disabled:cursor-default disabled:opacity-50`}>
        Reply
      </button>
    </form>
  );
}
