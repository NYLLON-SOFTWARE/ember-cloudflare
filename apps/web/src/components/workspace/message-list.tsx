import { startTransition, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { Invitation, Me } from "@ember/protocol";
import { ArrowDown } from "@/components/icons/campfire";
import { RefusedUnboosts, RoomConnection } from "@/hooks/use-room";
import { dropTarget } from "@/lib/drop-target";
import { dateLabel, dateTimeLabel, timeline } from "@/lib/messages";
import type { Focus, RoomState } from "@/lib/room-state";
import { InvitationCard } from "./invitation-card";
import { MessageItem, type MessageActions, type MessageEditors } from "./message-item";

/**
 * How near the end of the room's messages a reader can be and still be at it, which keeps them there as
 * new ones come, as ember-rust's scroll_manager.js has it (`AUTO_SCROLL_THRESHOLD`).
 */
const AT_END_PX = 100;
/** How near the view an end of the timeline comes before the page beyond it loads. */
const PAGE_AHEAD_PX = 200;
/**
 * How many of its newest messages a page that fills an empty timeline, as a room's first page does, shows
 * before the rest: more than a phone's view holds, so the rest go in above them, out of sight, once they're
 * on screen. Drawing a whole page at once is most of what opening a room waits on.
 */
const FIRST_DRAWN = 15;

/**
 * Campfire's `.message.search-highlight` (messages.css): the message a permalink goes to is outlined in
 * the ink for a second, then the outline fades over half a second. Drawn as an outline rather than a
 * border, so the message doesn't move, and run apart from its CSS, so a mention's wiggle still plays.
 */
const OUTLINE: Keyframe[] = [
  { outline: "2px solid var(--foreground)" },
  { outline: "2px solid var(--foreground)", offset: 2 / 3 },
  { outline: "2px solid transparent" },
];
const OUTLINE_MS = 1_500;

/** Where the reader is: a message's row, and how far its bottom is from the view's. */
interface Place {
  row: string;
  offset: number;
}

const rowsIn = (scroller: HTMLElement) => [...scroller.querySelectorAll<HTMLElement>("[data-row]")];

/**
 * Where the reader is in the timeline: the last message that starts above the view's bottom. Keeping it
 * where it is moves what's above it instead, which keeps the place of someone reading as older messages
 * come in above or the oldest are cut, or as a message above the view's bottom grows, as ember-rust's
 * maintain_scroll_controller.js keeps the bottom for an edit or a boost above the fold.
 */
function placeIn(scroller: HTMLElement): Place | null {
  const rows = rowsIn(scroller);
  const bottom = scroller.getBoundingClientRect().bottom;
  let [low, high] = [0, rows.length - 1];
  let found: HTMLElement | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle]!.getBoundingClientRect().top < bottom) [found, low] = [rows[middle], middle + 1];
    else high = middle - 1;
  }
  return found ? { row: found.dataset.row!, offset: bottom - found.getBoundingClientRect().bottom } : null;
}

/** Scrolls the timeline so the reader is at `place` again, if its message is still there. */
function restore(scroller: HTMLElement, { row, offset }: Place) {
  const element = rowsIn(scroller).find((r) => r.dataset.row === row);
  if (element) scroller.scrollTop += offset - (scroller.getBoundingClientRect().bottom - element.getBoundingClientRect().bottom);
}

/**
 * ember-rust's `.message__day-separator` (_message.html, zz-ember.css): a heading over the first message of
 * a day, with the day's date written out and, on hover, the message's date and time.
 */
function DaySeparator({ at }: { at: string }) {
  const date = new Date(at);
  return (
    <h2 className="mt-[13px] mb-6 flex items-center gap-3 text-sm leading-5 font-bold text-message-ink before:flex-1 before:border-t before:border-message-divider after:flex-1 after:border-t after:border-message-divider max-md:mb-[18px] max-md:gap-2">
      <time dateTime={at} title={dateTimeLabel(date)} className="rounded-[14px] border border-message-border bg-background px-4 py-[3px]">
        {dateLabel(date)}
      </time>
    </h2>
  );
}

interface Props {
  /** The room's name as the reader reads it, which a DM's names the others in it. */
  roomName: string;
  /** Whether the room is a DM, which a timeline is "with" rather than "in". */
  direct?: boolean;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  /** Dismisses the welcome card for good, settling once it's gone, or failed to go. */
  onDismissInvitation: () => Promise<void>;
  state: RoomState;
  me: Me;
  /** What can be done to the messages, or null for a room that's gone, whose messages stay as they are. */
  actions: MessageActions | null;
  /** The messages whose editors are open. */
  editing: ReadonlySet<string>;
  editors: MessageEditors;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  /** Goes to the newest messages, answering whether it could, which it can't while the room is away and they aren't loaded. */
  onJumpToNewest: () => boolean;
  /** Files dropped on the messages, which go to the composer, as ember-rust's message area sends them. */
  onDropFiles?: (files: FileList) => void;
}

/**
 * The scrolling timeline, as ember-rust's messages_controller.js keeps it. At the end of the room's
 * messages, it stays there as new ones come. Anywhere else, it keeps the reader's place, loads the pages
 * before and after as they near either end, and offers Jump to newest message when new ones come.
 */
export function MessageList({ roomName, direct = false, invitation, onDismissInvitation, state, me, actions, editing, editors, onLoadOlder, onLoadNewer, onJumpToNewest, onDropFiles = () => {} }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const place = useRef<Place | null>(null);
  const viewHeight = useRef(0);
  const focused = useRef<Focus | null>(null);
  const arrivals = useRef(state.arrivals);
  // Whether new messages have come that the reader isn't at the end to see.
  const [behind, setBehind] = useState(false);
  // Whether the timeline has drawn every message it holds: until it has, a page that fills it shows its newest
  // messages first, unless it's a permalink's, whose message goes in the middle.
  const [drawnAll, setDrawnAll] = useState(false);
  const items = timeline(state.messages);
  const newestFirst = !drawnAll && !state.focus?.messageId && items.length > FIRST_DRAWN;

  const nearEnd = (el: HTMLElement) => !state.hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_PX;

  // Keeps the reader at the end, or in their place, as what the timeline shows changes. A short last page
  // of later messages can leave them at the end without scrolling them, so this asks again.
  const settle = useEffectEvent(() => {
    const el = scroller.current!;
    if (atEnd.current) el.scrollTop = el.scrollHeight;
    else if (place.current) restore(el, place.current);
    atEnd.current = nearEnd(el);
    if (atEnd.current) setBehind(false);
    place.current = placeIn(el);
  });

  // Goes to a message, centred and outlined, as ember-rust's opens a permalink's, or, for none, to the
  // end, as sending and Jump to newest message go.
  const go = useEffectEvent((messageId: string | null) => {
    const el = scroller.current!;
    const row = messageId === null ? undefined : rowsIn(el).find((r) => r.dataset.messageId === messageId);
    if (row) {
      const view = el.getBoundingClientRect();
      const box = row.getBoundingClientRect();
      el.scrollTop += box.top - view.top - (el.clientHeight - box.height) / 2;
      row.querySelector("[data-body-content]")?.animate?.(OUTLINE, OUTLINE_MS);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    atEnd.current = nearEnd(el);
    place.current = placeIn(el);
    setBehind(false);
  });

  useLayoutEffect(() => {
    const moved = state.focus !== focused.current;
    focused.current = state.focus;
    if (moved && state.focus) go(state.focus.messageId);
    else settle();
  }, [state.messages, state.focus, drawnAll]);

  // A page that showed its newest messages first draws the rest above them once they're on screen, or before the
  // view is painted where they don't fill it with room to spare, so that nothing shows above them meanwhile.
  useLayoutEffect(() => {
    if (drawnAll || items.length === 0) return;
    if (newestFirst && content.current!.offsetHeight >= scroller.current!.clientHeight + PAGE_AHEAD_PX) startTransition(() => setDrawnAll(true));
    else setDrawnAll(true);
  }, [drawnAll, newestFirst, items.length]);

  // When the timeline gets shorter, as it does when a phone's keyboard opens, or what it shows changes size
  // after it's drawn, the reader stays where they were.
  useEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => {
      viewHeight.current = el.clientHeight;
      settle();
    });
    observer.observe(el);
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, []);

  // New messages the reader can't see, away from the end, offer the way there.
  useEffect(() => {
    if (state.arrivals === arrivals.current) return;
    arrivals.current = state.arrivals;
    if (!atEnd.current) setBehind(true);
  }, [state.arrivals]);

  // What an observer saw is about the timeline it was made for: the browser can tell it after the timeline has
  // changed, as when a room's first messages come before it has looked, and the observer made for the new one
  // says whether its end is near.
  const loadOlder = useEffectEvent((shown: RoomState["messages"]) => shown === state.messages && state.hasMore && !state.loadingOlder && onLoadOlder());
  const loadNewer = useEffectEvent((shown: RoomState["messages"]) => shown === state.messages && state.hasNewer && !state.loadingNewer && onLoadNewer());
  useEffect(() => {
    // Load the page beyond either end of the timeline whenever that end comes near the view, whether by
    // scrolling, a resize, or a window tall enough to show every loaded message. Observing afresh after
    // each change asks again while the end is still near, but a failed page changes nothing, so it waits
    // for the reader instead of retrying in a loop.
    const shown = state.messages;
    const root = scroller.current;
    const older = new IntersectionObserver(([entry]) => entry?.isIntersecting && loadOlder(shown), { root, rootMargin: `${PAGE_AHEAD_PX}px 0px 0px 0px` });
    const newer = new IntersectionObserver(([entry]) => entry?.isIntersecting && loadNewer(shown), { root, rootMargin: `0px 0px ${PAGE_AHEAD_PX}px 0px` });
    older.observe(top.current!);
    newer.observe(bottom.current!);
    return () => {
      older.disconnect();
      newer.disconnect();
    };
  }, [state.messages]);

  const onScroll = () => {
    const el = scroller.current!;
    // A resize scrolls the timeline to keep its end in view for a reader at it, and that scroll can arrive once
    // the timeline has resized again, before the resize observer has caught up, leaving them at the end of the
    // view as it was. They didn't move, so they're still at the end. Any other scroll is the reader's, even one
    // that comes as the timeline resizes, as it does while the composer's editor loads.
    const stillAtEnd = atEnd.current && !state.hasNewer && el.scrollHeight - el.scrollTop - viewHeight.current <= 1;
    atEnd.current = nearEnd(el) || stillAtEnd;
    if (atEnd.current) setBehind(false);
    place.current = placeIn(el);
  };

  // As in ember-rust, the card shows in its room while the room is new, and it's the room's welcome, but
  // only to the administrators who haven't dismissed it, who alone are given the invitation.
  const welcomeCard = invitation !== null && state.paged === false;
  // Until the room lets the socket in, which brings its messages afresh. The timeline is busy then, and while it
  // draws a page newest first, so screen readers read the page once it's whole.
  const waiting = state.status === "connecting" || state.status === "reconnecting";

  return (
    <div className="min-h-0 flex-1" {...dropTarget(onDropFiles)}>
      {/* `isolate` keeps the message controls' z-indexes inside the timeline, so Jump to newest message
          below stays above them, as in ember-rust (zz-ember.css, `.message-area__return-to-latest`). */}
      <div ref={scroller} onScroll={onScroll} className="isolate h-full overflow-x-hidden overflow-y-auto overscroll-contain pt-[26px] pb-[18px] [scrollbar-gutter:stable] max-md:pt-[18px] max-md:pb-3" role="log" aria-live="polite" aria-label={`Messages ${direct ? "with" : "in"} ${roomName}`} aria-busy={waiting || newestFirst || undefined}>
        <div ref={content}>
          <div ref={top} aria-hidden className="h-px" />
          {state.loadingOlder && <p className="py-2 text-center text-xs text-muted-foreground">Loading earlier messages…</p>}

          {welcomeCard && <InvitationCard joinCode={invitation.joinCode} onDismiss={onDismissInvitation} />}

          {state.status === "open" && items.length === 0 && !state.hasMore && !state.hasNewer && !welcomeCard && (
            <div className="p-6 text-center text-muted-foreground">
              <h2 className="mb-1.5 text-xl text-foreground">{direct ? roomName : `Welcome to #${roomName}`}</h2>
              <p>{direct ? "This is the very beginning of your direct messages." : "This is the very beginning of the room. Say hello!"}</p>
            </div>
          )}

          <RoomConnection value={state.connections}>
            <RefusedUnboosts value={state.refusedUnboosts}>
              {(newestFirst ? items.slice(-FIRST_DRAWN) : items).map(({ message, firstOfDay, threaded }) => {
                // Stable from optimistic copy to stored message, and distinct across senders.
                const key = `${message.creator.id}:${message.clientMessageId}`;
                return (
                  <div key={key} data-row={key} data-message-id={message.id}>
                    {firstOfDay && <DaySeparator at={message.createdAt} />}
                    <MessageItem message={message} me={me} threaded={threaded} editing={editing.has(message.id)} actions={actions} editors={editors} />
                  </div>
                );
              })}
            </RefusedUnboosts>
          </RoomConnection>
          <div ref={bottom} aria-hidden className="h-px" />
        </div>
      </div>

      {/* ember-rust's sits 160px above the bottom of the main content, which holds the composer too. */}
      {behind && (
        <button
          type="button"
          // Kept to try again when it can't go yet.
          onClick={() => onJumpToNewest() && setBehind(false)}
          aria-label="Jump to newest message"
          className="absolute bottom-[160px] left-1/2 z-[3] flex size-[38px] -translate-x-1/2 cursor-pointer items-center justify-center rounded-full border bg-background shadow-[0_3px_12px_#00000014] touch:size-11"
        >
          <ArrowDown className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
