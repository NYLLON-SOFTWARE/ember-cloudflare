import { useEffect, useRef } from "react";
import type { Me, Room, SavedItem } from "@ember/protocol";
import { Bookmark, NavArrowRight, Trash, Xmark } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { permalinkOf } from "@/hooks/use-route";
import { dateLabel, dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { MessageItem, NO_EDITORS } from "./message-item";
import { RoomMark, useSearchNames } from "./search-box";

/**
 * The messages you've saved for later, beside the room as a thread is: a header with Saved and Close,
 * then each, newest save first, as a card naming the room it lives in and the day it was saved, with
 * the message as the room has it now, a link to Jump there, and Remove to forget it. Opening it asks
 * nothing of the rooms, so it marks nothing read; a save whose message is gone, or whose room you can
 * no longer see, has already left, in the answer that said so. Below 1180px wide it covers the room,
 * and on phones the whole page, with Close in its header.
 */
export function SavedPanel({ me, rooms, saves, onClose, onForget }: { me: Me; rooms: readonly Room[]; saves: SavedItem[] | null; onClose: () => void; onForget: (id: string) => void }) {
  const names = useSearchNames(me, rooms);
  // Opening the pane takes focus, as one that covers the room must, to its Close, which the drawer's
  // own closing leaves alone, since focus has gone somewhere by then.
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
  }, []);
  return (
    <aside
      data-saved
      aria-label="Saved"
      className={cn(
        // Placed in the room's column, or the page's on phones, over the room, and from 1180px wide in its own.
        "absolute inset-0 z-10 col-start-3 row-span-2 row-start-1 flex min-h-0 min-w-0 flex-col bg-background max-md:col-start-1",
        "pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)] min-[1180px]:relative min-[1180px]:col-start-4 min-[1180px]:border-l",
      )}
    >
      <header className="flex min-h-header items-center gap-2.5 border-b py-2.5 pr-3.5 pl-5 max-md:min-h-[calc(56px+env(safe-area-inset-top))] max-md:gap-1.5 max-md:px-2 max-md:pt-[env(safe-area-inset-top)] max-md:pb-0">
        <h2 className="shrink-0 text-[17px] leading-[1.4] font-[650] max-md:text-base max-md:leading-5">Saved</h2>
        <button
          ref={close}
          type="button"
          aria-label="Close saved messages"
          onClick={onClose}
          className="ml-auto grid size-9 shrink-0 place-items-center rounded-[10px] text-foreground hover:bg-hover touch:size-11"
        >
          <Xmark className="size-5" />
        </button>
      </header>
      <section aria-label="Saved messages" className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(18px,env(safe-area-inset-bottom))] [scrollbar-gutter:stable] max-md:px-3 max-md:pt-3">
        {saves === null ? (
          <p className="px-1 text-[15px] text-muted-foreground">Loading…</p>
        ) : saves.length === 0 ? (
          <div className="grid justify-items-center px-4 pt-[8dvh] pb-6 text-center text-muted-foreground">
            <Bookmark className="mb-4 h-auto w-12 max-w-[25vw] text-foreground opacity-20" />
            <h3 className="mb-1.5 text-lg font-bold text-foreground">Nothing saved yet</h3>
            <p>Save a message from its More actions to find it here.</p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {saves.map((save) => (
              <li key={save.id}>
                <SavedMessage save={save} room={names.room(save.message.roomId)} me={me} names={names} onForget={onForget} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </aside>
  );
}

/** The room or person a search is narrowed to, as a pressed chip, which takes the filter off. */
type Names = ReturnType<typeof useSearchNames>;

/**
 * A message you've saved, as a card, in the image of a search result: its room's icon and name, and the
 * day it was saved, over the message, which can't be changed here, with Jump, to the message where it is,
 * and Remove, which forgets the save.
 */
function SavedMessage({ save, room, me, names, onForget }: { save: SavedItem; room: Room | null; me: Me; names: Names; onForget: (id: string) => void }) {
  const { message } = save;
  const savedOn = new Date(save.createdAt);
  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex min-h-9 items-center gap-2 border-b bg-surface px-3.5 py-1.5 text-[13px] text-muted-foreground">
        <RoomMark room={room} size={15} />
        <span className="min-w-0 truncate font-semibold text-foreground">{room ? names.roomName(room) : "A room you've left"}</span>
        <span aria-hidden>·</span>
        <time dateTime={new Date(save.createdAt).toISOString()} title={dateTimeLabel(savedOn)} className="shrink-0">
          {dateLabel(savedOn)}
        </time>
        <PageLink
          href={permalinkOf(message)}
          className="ml-auto inline-flex shrink-0 items-center justify-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium hover:bg-hover hover:text-foreground touch:min-h-11 touch:min-w-11"
        >
          Jump
          <NavArrowRight className="size-4" />
        </PageLink>
        <button
          type="button"
          aria-label="Remove from saved"
          title="Remove from saved"
          onClick={() => onForget(save.id)}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-hover hover:text-foreground touch:size-11"
        >
          <Trash className="size-3.5" />
        </button>
      </div>
      <div className="pb-1">
        <MessageItem message={message} me={me} threaded={false} editing={false} actions={null} editors={NO_EDITORS} />
      </div>
    </div>
  );
}
