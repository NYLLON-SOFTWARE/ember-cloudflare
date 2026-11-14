import { useEffect } from "react";
import type { Me, Message, Room } from "@ember/protocol";
import { ArrowLeft, ChatBubbleEmpty, Pin as PinIcon, Xmark } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { useNameOf } from "@/hooks/use-directory";
import { messagePath } from "@/hooks/use-route";
import type { Pin } from "@/hooks/use-pins";
import { dateTimeLabel, timeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { MessageItem, type MessageEditors } from "./message-item";
import { RoomNotice } from "./room-notice";

/** The panel's messages can't be changed from it: they show as their room's timeline holds them. */
const noEditors: MessageEditors = { open: () => {}, close: () => {}, returnFocus: () => {}, attach: () => {}, reply: () => {} };

interface Props {
  room: Room;
  /** The room's name as the reader reads it, which a DM's names the others in it. */
  name: string;
  me: Me;
  /** The room's pins, oldest pinned first, or null while the room hasn't said. */
  pins: Pin[] | null;
  /** The messages the room has listed, by id. */
  messages: ReadonlyMap<string, Message>;
  /** Takes a pin away, or null where nothing can be changed, as in a room that's gone. */
  onUnpin: ((messageId: string) => void) | null;
  /** Asks the room for its pins again, as the panel opens and as a pin of an unknown time shows. */
  refresh: () => void;
  /** What the room has to say while the panel covers it, as why it refused an unpin. */
  roomNotice: string | null;
  onDismissRoomNotice: () => void;
  onClose: () => void;
}

/**
 * A room's pinned messages, beside it in the thread panel's place: the messages in pin order, each with
 * who pinned it and when, a Jump to it in the room, and Unpin. From 1180px wide it's a column of its own
 * at the room's right, below that it covers the room, and on phones the whole page, with Back in its
 * header in Close's place.
 */
export function PinnedPanel({ room, name, me, pins, messages, onUnpin, refresh, roomNotice, onDismissRoomNotice, onClose }: Props) {
  const nameOf = useNameOf();
  const direct = room.kind === "direct";

  // The room is asked again whenever the pins whose times wait for their listing change, which
  // opening asks for. Their ids, not a whether-any one, or a listing and a new pin taken in
  // together, both waiting before and after, would go unasked.
  const waiting = pins
    ?.filter(({ at }) => at === null)
    .map(({ messageId }) => messageId)
    .sort()
    .join(" ");
  useEffect(() => {
    if (waiting) refresh();
  }, [waiting, refresh]);

  return (
    <aside
      data-pins
      aria-label="Pinned messages"
      className={cn(
        // Placed in the room's column, or the page's on phones, over the room, and from 1180px wide in its own.
        "absolute inset-0 z-10 col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-background max-md:col-start-1",
        "pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)] min-[1180px]:relative min-[1180px]:col-start-4 min-[1180px]:border-l",
      )}
    >
      <header className="flex min-h-header items-center gap-2.5 border-b py-2.5 pr-3.5 pl-5 max-md:min-h-[calc(56px+env(safe-area-inset-top))] max-md:gap-1.5 max-md:px-2 max-md:pt-[env(safe-area-inset-top)] max-md:pb-0">
        <button type="button" aria-label={`Back to ${name}`} onClick={onClose} className="hidden size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg max-md:flex">
          <ArrowLeft className="size-[22px]" />
        </button>
        <div className="flex min-w-0 items-center gap-2.5 max-md:flex-col max-md:items-start max-md:gap-0">
          <h2 className="shrink-0 text-[17px] leading-[1.4] font-[650] max-md:text-base max-md:leading-5">Pinned</h2>
          <span className={cn(ROOM_NAME, "inline-flex items-center gap-[5px]")}>
            {direct ? <ChatBubbleEmpty className="size-4 shrink-0" /> : <RoomIcon icon={room.icon} size={16} className="shrink-0 text-[16px] leading-none" />}
            <span className="truncate">{name}</span>
          </span>
        </div>
        <button
          type="button"
          title="Close pinned messages"
          aria-label="Close pinned messages"
          onClick={onClose}
          className="ml-auto grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] text-foreground hover:bg-hover touch:size-11 max-md:hidden"
        >
          <Xmark className="size-5" />
        </button>
      </header>
      <RoomNotice notice={roomNotice} onDismiss={onDismissRoomNotice} />
      <div role="list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2">
        {pins !== null && pins.length === 0 && <p className="px-5 py-2 text-[15px] leading-[22px] text-message-muted max-md:px-3">Nothing pinned yet.</p>}
        {pins?.map((pin) => {
          const message = messages.get(pin.messageId);
          if (!message) return null;
          return (
            <div key={pin.messageId} role="listitem" className="border-b border-message-divider last:border-b-0">
              <MessageItem message={message} me={me} threaded={false} editing={false} actions={null} editors={noEditors} />
              <div className="mx-5 -mt-1 mb-2 flex items-center gap-2 text-[13px] leading-[18px] text-message-muted max-md:mx-3">
                <PinIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  Pinned by {nameOf(pin.by)}
                  {pin.at !== null && (
                    <>
                      {" "}
                      <time dateTime={pin.at} title={dateTimeLabel(new Date(pin.at))}>
                        at {timeLabel(new Date(pin.at))}
                      </time>
                    </>
                  )}
                </span>
                <span className="ml-auto flex flex-none items-center gap-3">
                  <PageLink href={messagePath(room.id, pin.messageId)} onClick={onClose} className={PANEL_LINK}>
                    Jump
                  </PageLink>
                  {onUnpin !== null && (
                    <button type="button" className={PANEL_LINK} onClick={() => onUnpin(pin.messageId)}>
                      Unpin
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

const ROOM_NAME = "max-w-full min-w-0 truncate text-sm leading-5 text-muted-foreground";
const PANEL_LINK = "cursor-pointer rounded text-link no-underline hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground";
