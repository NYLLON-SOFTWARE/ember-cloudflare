import { useLayoutEffect, useRef, useState } from "react";
import type { User } from "@ember/protocol";
import { ArrowDown } from "lucide-react";
import { timeline } from "@/lib/messages";
import type { RoomState } from "@/lib/room-state";
import { MessageItem, type MessageActions } from "./message-item";

const NEAR_BOTTOM_PX = 120;

interface Props {
  roomName: string;
  state: RoomState;
  me: User;
  actions: MessageActions;
  onLoadOlder: () => void;
}

/** The scrolling timeline. Stays pinned to the newest message unless you've scrolled up. */
export function MessageList({ roomName, state, me, actions, onLoadOlder }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const previousHeight = useRef(0);
  const firstId = useRef<string | undefined>(undefined);
  const [showLatest, setShowLatest] = useState(false);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const oldest = state.messages[0]?.id;
    if (firstId.current && oldest !== firstId.current && !pinned.current) {
      // Older history was prepended: keep the reader's place.
      el.scrollTop += el.scrollHeight - previousHeight.current;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
    firstId.current = oldest;
    previousHeight.current = el.scrollHeight;
  }, [state.messages]);

  const onScroll = () => {
    const el = scroller.current!;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    setShowLatest(!pinned.current);
    previousHeight.current = el.scrollHeight;
    if (el.scrollTop < 200 && state.hasMore && !state.loadingOlder) onLoadOlder();
  };

  const items = timeline(state.messages);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="h-full overflow-x-hidden overflow-y-auto overscroll-contain pt-[26px] pb-[18px] [scrollbar-gutter:stable] max-md:pt-[18px] max-md:pb-3" role="log" aria-live="polite" aria-label={`Messages in ${roomName}`}>
        {state.loadingOlder && <p className="py-2 text-center text-xs text-muted-foreground">Loading earlier messages…</p>}

        {state.status === "open" && items.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">
            <h2 className="mb-1.5 text-xl text-foreground">Welcome to #{roomName}</h2>
            <p>This is the very beginning of the room. Say hello!</p>
          </div>
        )}

        {items.map(({ message, daySeparator, threaded }) => (
          <div key={message.clientMessageId}>
            {daySeparator && (
              <div role="separator" className="mx-0 mt-[13px] mb-6 flex items-center gap-3 text-sm leading-5 font-bold text-message-ink before:flex-1 before:border-t before:border-message-divider after:flex-1 after:border-t after:border-message-divider max-md:mb-[18px] max-md:gap-2">
                <span className="rounded-[14px] border border-message-border bg-background px-4 py-[3px]">{daySeparator}</span>
              </div>
            )}
            <MessageItem message={message} me={me} threaded={threaded} actions={actions} />
          </div>
        ))}
      </div>

      {showLatest && (
        <button
          type="button"
          onClick={() => {
            pinned.current = true;
            scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
          }}
          aria-label="Return to latest messages"
          className="absolute right-6 bottom-4 z-[3] flex size-[38px] items-center justify-center rounded-full border bg-background shadow-[0_3px_12px_#00000014] hover:bg-hover"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
