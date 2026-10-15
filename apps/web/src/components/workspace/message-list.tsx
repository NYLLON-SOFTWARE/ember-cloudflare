import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { Invitation, Me } from "@ember/protocol";
import { ArrowDown } from "@/components/icons/campfire";
import { RoomConnection } from "@/hooks/use-room";
import { timeline } from "@/lib/messages";
import type { RoomState } from "@/lib/room-state";
import { InvitationCard } from "./invitation-card";
import { MessageItem, type MessageActions, type MessageEditors } from "./message-item";

const NEAR_BOTTOM_PX = 120;

interface Props {
  roomName: string;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  state: RoomState;
  me: Me;
  /** What can be done to the messages, or null for a room that's gone, whose messages stay as they are. */
  actions: MessageActions | null;
  /** The messages whose editors are open. */
  editing: ReadonlySet<string>;
  editors: MessageEditors;
  onLoadOlder: () => void;
}

/** The scrolling timeline. Stays pinned to the newest message unless you've scrolled up. */
export function MessageList({ roomName, invitation, state, me, actions, editing, editors, onLoadOlder }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const viewHeight = useRef(0);
  // Where the reader was after the last render, resize or scroll.
  const position = useRef({ top: 0, height: 0 });
  const firstId = useRef<string | undefined>(undefined);
  const [showLatest, setShowLatest] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const oldest = state.messages[0]?.id;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    } else if (oldest !== firstId.current && state.messages.some(({ id }) => id === firstId.current)) {
      // Older history was prepended: keep the reader's place. Measure from where they were, since
      // the browser's own scroll anchoring may already have moved scrollTop by the same amount.
      el.scrollTop = position.current.top + el.scrollHeight - position.current.height;
    }
    firstId.current = oldest;
    position.current = { top: el.scrollTop, height: el.scrollHeight };
  }, [state.messages]);

  // When the timeline gets shorter, as it does when a phone's keyboard opens, stay on the newest
  // message rather than leaving it hidden below the fold.
  useEffect(() => {
    const el = scroller.current!;
    const observer = new ResizeObserver(() => {
      viewHeight.current = el.clientHeight;
      if (pinned.current) el.scrollTop = el.scrollHeight;
      position.current = { top: el.scrollTop, height: el.scrollHeight };
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const loadOlder = useEffectEvent(() => state.hasMore && !state.loadingOlder && onLoadOlder());
  useEffect(() => {
    // Load the previous page whenever the top of the timeline comes into view, whether by
    // scrolling, a resize, or a window tall enough to show every loaded message. Observing
    // afresh after each change asks again while the top is still in view, but a failed page
    // changes nothing, so it waits for the reader instead of retrying in a loop.
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && loadOlder(), {
      root: scroller.current,
      rootMargin: "200px 0px 0px 0px",
    });
    observer.observe(top.current!);
    return () => observer.disconnect();
  }, [state.messages]);

  const onScroll = () => {
    const el = scroller.current!;
    // A scroll can arrive after the timeline has resized but before the resize observer has caught
    // up. The reader didn't move, so it mustn't unpin them from the newest message.
    if (el.clientHeight !== viewHeight.current) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setShowLatest(!pinned.current);
    position.current = { top: el.scrollTop, height: el.scrollHeight };
  };

  const items = timeline(state.messages);
  // As in ember-rust, the card shows in its room while the room is new, and it's the room's welcome.
  const welcomeCard = invitation !== null && state.paged === false;
  // Until the room lets the socket in, which brings its messages afresh.
  const waiting = state.status === "connecting" || state.status === "reconnecting";

  return (
    <div className="relative min-h-0 flex-1">
      {/* `isolate` keeps the message controls' z-indexes inside the timeline, so the return button
          below stays above them, as in ember-rust (zz-ember.css, `.message-area__return-to-latest`). */}
      <div ref={scroller} onScroll={onScroll} className="isolate h-full overflow-x-hidden overflow-y-auto overscroll-contain pt-[26px] pb-[18px] [scrollbar-gutter:stable] max-md:pt-[18px] max-md:pb-3" role="log" aria-live="polite" aria-label={`Messages in ${roomName}`} aria-busy={waiting || undefined}>
        <div ref={top} aria-hidden className="h-px" />
        {state.loadingOlder && <p className="py-2 text-center text-xs text-muted-foreground">Loading earlier messages…</p>}

        {welcomeCard && <InvitationCard joinCode={invitation.joinCode} />}

        {state.status === "open" && items.length === 0 && !state.hasMore && !welcomeCard && (
          <div className="p-6 text-center text-muted-foreground">
            <h2 className="mb-1.5 text-xl text-foreground">Welcome to #{roomName}</h2>
            <p>This is the very beginning of the room. Say hello!</p>
          </div>
        )}

        <RoomConnection value={state.connections}>
          {items.map(({ message, daySeparator, threaded }) => (
            // Stable from optimistic copy to stored message, and distinct across senders.
            <div key={`${message.creator.id}:${message.clientMessageId}`}>
              {daySeparator && (
                <div role="separator" className="mx-0 mt-[13px] mb-6 flex items-center gap-3 text-sm leading-5 font-bold text-message-ink before:flex-1 before:border-t before:border-message-divider after:flex-1 after:border-t after:border-message-divider max-md:mb-[18px] max-md:gap-2">
                  <span className="rounded-[14px] border border-message-border bg-background px-4 py-[3px]">{daySeparator}</span>
                </div>
              )}
              <MessageItem message={message} me={me} threaded={threaded} editing={editing.has(message.id)} actions={actions} editors={editors} />
            </div>
          ))}
        </RoomConnection>
      </div>

      {showLatest && (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
          }}
          aria-label="Return to latest messages"
          className="absolute right-6 bottom-4 z-[3] flex size-[38px] items-center justify-center rounded-full border bg-background shadow-[0_3px_12px_#00000014] hover:bg-hover touch:size-11"
        >
          <ArrowDown className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
