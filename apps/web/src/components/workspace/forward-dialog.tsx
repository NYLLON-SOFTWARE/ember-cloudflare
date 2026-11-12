import { useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { workspacePageOf, type Message, type Room, type ShareWidening } from "@ember/protocol";
import { Xmark } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { useFlash } from "@/components/flash";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useNameOf } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, forwardMessage, isSignedOut } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { roomDisplayName } from "@/lib/sub-rooms";
import { cn } from "@/lib/utils";
import { returnFocus } from "./new-direct-dialog";
import { ConversationsContext } from "./quote-cite";
import { ShareWarning, shareWidening, type SharePlace } from "./share-warning";

// Forward message, as Slack's is: pick a conversation you're in, or a thread in one by pasting a link to a
// message, add a note if you like, and the message goes there quoted, as Quote quotes one, naming where it's
// from. It lists the rooms the sidebar already has, so it searches as you type. Where the conversation picked
// reaches people who can't see the original, it asks first (share-warning.tsx). It shows only what forwarding
// needs: the field, the conversations, the note, what's forwarded, and why something didn't work.

/** Campfire's `.btn`. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground";
const FOOTER_BUTTON = "min-h-[42px] px-4 py-2.5 touch:min-h-11 upto-500px:min-h-11";

/** How many conversations it lists at a time. */
const LISTED = 20;

/**
 * Where a forward goes: a conversation, as it's named to the reader, without the `#` a room's icon draws in
 * the list, "Engineering – Backend" for a sub-room, or a thread in one.
 */
export interface Destination {
  room: Room;
  name: string;
  /** The message whose thread it goes in, if it goes in one. */
  parentId?: string;
}

const destinationKey = ({ room, parentId }: Destination) => `${room.id}/${parentId ?? ""}`;

/**
 * The thread a pasted link to a message names, in one of `rooms`: the message's own, or for a reply, its
 * parent's, or null when it names none.
 */
export function threadOfLink(typed: string, rooms: readonly Room[]): { room: Room; parentId: string } | null {
  let url: URL;
  try {
    url = new URL(typed.trim(), location.href);
  } catch {
    return null;
  }
  if (url.origin !== location.origin || !/^https?:/.test(typed.trim())) return null;
  const page = workspacePageOf(url.pathname);
  if (page?.page !== "room") return null;
  const parentId = page.threadId ?? page.messageId;
  const room = rooms.find((r) => r.id === page.roomId);
  return room && parentId ? { room, parentId } : null;
}

/** The conversations among `destinations` whose names hold `typed`, ignoring case. */
export function matching(destinations: Destination[], typed: string): Destination[] {
  const sought = typed.trim().replace(/^#/, "").toLowerCase();
  return sought === "" ? destinations : destinations.filter(({ name }) => name.toLowerCase().includes(sought));
}

interface Props {
  message: Message;
  /** What opened it, which takes focus again as it closes. */
  opener: HTMLElement | null;
  onClose: () => void;
}

/**
 * Forward message: a search of the conversations you're in, or a pasted link to a message for its thread,
 * picked by pointer or with the arrow keys and Enter, a note, and Forward, which posts the message there,
 * quoted, after the note, and flashes that it did. It can't close while it's forwarding.
 */
export function ForwardDialog({ message, opener, onClose }: Props) {
  const conversations = useContext(ConversationsContext);
  const nameOf = useNameOf();
  const flash = useFlash();
  const mounted = useMounted();
  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(true);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Destination | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // How many people the conversation picked would show the message to who can't see it now, while that's asked.
  const [widening, setWidening] = useState<ShareWidening | null>(null);

  const rooms = conversations?.rooms ?? [];
  const meId = conversations?.meId ?? "";
  // A conversation's name, and as text names it elsewhere, with a room's `#`.
  const named = (room: Room) => (room.kind === "direct" ? roomName(room, meId, nameOf) : roomDisplayName(room, rooms));
  const labeled = (room: Room) => (room.kind === "direct" ? named(room) : `#${named(room)}`);
  const destinations = useMemo(() => rooms.map((room) => ({ room, name: named(room) })), [rooms, meId, nameOf]);
  const linked = threadOfLink(typed, rooms);
  const options: Destination[] = linked
    ? [{ room: linked.room, name: `Thread in ${labeled(linked.room)}`, parentId: linked.parentId }]
    : matching(destinations, typed).slice(0, LISTED);
  const optionId = (destination: Destination) => `${listId}-${destinationKey(destination)}`;

  const close = () => {
    if (!sending) setOpen(false);
  };

  // Going Back or Forward closes it too.
  const historyMoved = useEffectEvent(close);
  useEffect(() => {
    const listener = () => historyMoved();
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  const find = (value: string) => {
    setTyped(value);
    setHighlighted(null);
    setFailure(null);
  };

  const pick = (destination: Destination) => {
    if (sending) return;
    setPicked(destination);
    setTyped("");
    setHighlighted(null);
    setFailure(null);
  };

  const unpick = () => {
    if (sending) return;
    setPicked(null);
    setFailure(null);
    // The field comes back once the chip goes.
    requestAnimationFrame(() => search.current?.focus());
  };

  // The arrows move through the conversations listed, round from either end, and Enter picks the one highlighted.
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
      event.preventDefault();
      const index = options.findIndex((option) => destinationKey(option) === highlighted);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = options[index === -1 ? (step > 0 ? 0 : options.length - 1) : (index + step + options.length) % options.length]!;
      setHighlighted(destinationKey(next));
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options.find((option) => destinationKey(option) === highlighted) ?? (options.length === 1 ? options[0] : undefined);
      if (option) pick(option);
    }
  };

  /** Where a conversation is, as the warning names it: "#design", or a DM's people. */
  const place = (room: Room): SharePlace => ({ label: labeled(room), direct: room.kind === "direct" });

  const failed = (error: unknown) => {
    if (isSignedOut(error)) flash("alert", "You’ve been signed out.");
    if (!mounted.current) return;
    setSending(false);
    setFailure(error instanceof ApiError && error.status === 422 ? error.message : "Couldn’t forward the message. Please try again.");
  };

  const forward = async (to: Destination) => {
    setSending(true);
    setFailure(null);
    try {
      await forwardMessage(message.roomId, message.id, { to: to.room.id, parentId: to.parentId, note, clientMessageId: crypto.randomUUID() });
      flash("notice", to.parentId ? `Message forwarded to a thread in ${labeled(to.room)}` : `Message forwarded to ${labeled(to.room)}`);
      if (mounted.current) {
        setSending(false);
        setOpen(false);
      }
    } catch (error) {
      failed(error);
    }
  };

  // Forward asks first where the conversation reaches people who can't see the original.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picked || sending) return;
    setSending(true);
    setFailure(null);
    let check: Awaited<ReturnType<typeof shareWidening>>;
    try {
      check = await shareWidening(message.roomId, picked.room.id);
    } catch (error) {
      return failed(error);
    }
    if (!mounted.current) return;
    if (check?.widens) {
      setSending(false);
      setWidening(check);
      return;
    }
    await forward(picked);
  };

  const status = sending ? "Forwarding…" : (failure ?? (!picked && options.length === 0 ? "No conversations found." : null));
  const source = conversations?.rooms.find((room) => room.id === message.roomId);

  return (
    <Dialog open={open} onOpenChange={(open) => open || close()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName="bg-dialog-backdrop backdrop-blur-[3px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          search.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus(opener);
          onClose();
        }}
        className={cn(
          "block w-[540px] max-w-[calc(100dvw-24px-env(safe-area-inset-left)-env(safe-area-inset-right))] sm:max-w-[calc(100dvw-24px-env(safe-area-inset-left)-env(safe-area-inset-right))]",
          "max-h-[calc(100dvh-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto rounded-[18px] p-0 text-foreground shadow-[0_24px_80px_var(--color-dialog-shadow)]",
        )}
      >
        <form onSubmit={(event) => void submit(event)}>
          <DialogTitle className="px-6 pt-6 pb-5 text-[20px] leading-[1.3] font-bold upto-500px:px-4 upto-500px:py-5">Forward message</DialogTitle>

          {picked ? (
            <div className="mx-6 flex min-h-[46px] items-center upto-500px:mx-4">
              <button
                type="button"
                aria-label={`Remove ${picked.parentId ? picked.name : labeled(picked.room)}`}
                onClick={unpick}
                className="inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1 rounded-[20px] border bg-surface py-[7px] ps-3 pe-2.5 text-[13px] text-foreground wrap-anywhere touch:min-h-11"
              >
                {picked.parentId ? picked.name : labeled(picked.room)}
                <Xmark className="size-4 flex-none" />
              </button>
            </div>
          ) : (
            <label className="mx-6 flex min-h-[46px] cursor-text items-center gap-2.5 rounded-[10px] border px-3 py-2.5 focus-within:border-muted-foreground focus-within:ring-1 focus-within:ring-muted-foreground upto-500px:mx-4">
              <span className="sr-only">Search conversations</span>
              <input
                ref={search}
                type="text"
                value={typed}
                placeholder="Search for a conversation, or paste a message link"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-ember-preserve-selection
                role="combobox"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={highlighted && options.some((option) => destinationKey(option) === highlighted) ? `${listId}-${highlighted}` : undefined}
                onChange={(event) => find(event.target.value)}
                onKeyDown={keyDown}
                className="w-full min-w-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none upto-500px:text-base touch:text-base"
              />
            </label>
          )}

          {!picked && (
            <div className="max-h-[min(280px,34dvh)] min-h-[120px] overflow-y-auto overscroll-contain px-4 pt-3.5 pb-2">
              <div id={listId} role="listbox" aria-label="Conversations">
                {options.map((option) => (
                  <button
                    key={destinationKey(option)}
                    id={optionId(option)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={destinationKey(option) === highlighted}
                    onClick={() => pick(option)}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-[9px] px-2 py-2 text-start text-foreground hover:bg-hover aria-selected:bg-hover"
                  >
                    {option.parentId === undefined && option.room.kind !== "direct" && (
                      <RoomIcon icon={option.room.icon} size={18} className="w-[18px] shrink-0 text-center text-[20px] leading-none text-muted-foreground" />
                    )}
                    <span className="min-w-0 wrap-anywhere">{option.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <p role="status" className="mx-6 mt-2 min-h-4 text-xs text-muted-foreground empty:hidden upto-500px:mx-4">
            {status}
          </p>

          <div className="px-6 pt-3 upto-500px:px-4">
            <label className="block">
              <span className="sr-only">Note</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a message"
                rows={2}
                className="block w-full resize-y rounded-[10px] border bg-transparent px-3 py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground touch:text-base"
              />
            </label>
            <ForwardedPreview message={message} />
          </div>

          <footer className="mt-5 flex justify-end gap-2.5 border-t px-6 py-[18px] upto-500px:p-4">
            <button type="button" onClick={close} className={cn(BUTTON, FOOTER_BUTTON)}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!picked || sending}
              className={cn(
                BUTTON,
                FOOTER_BUTTON,
                "border-transparent bg-foreground text-background hover:not-active:brightness-70 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale disabled:contrast-50",
              )}
            >
              Forward
            </button>
          </footer>
        </form>
        {widening !== null && picked && (
          <ShareWarning
            source={source ? place(source) : { label: "this conversation", direct: false }}
            target={place(picked.room)}
            widening={widening}
            subject="message"
            confirm="Forward"
            action="Forward"
            onShare={() => {
              setWidening(null);
              void forward(picked);
            }}
            onCancel={() => setWidening(null)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What's being forwarded, as its quote will show it: its author and the start of its text, or its file's name. */
function ForwardedPreview({ message }: { message: Message }) {
  const nameOf = useNameOf();
  return (
    <div className="mt-3 border-s-[0.5ch] border-muted-foreground ps-[1.5ch] text-sm">
      <p className="font-semibold text-message-ink">{nameOf(message.creator)}</p>
      <p className="line-clamp-3 whitespace-pre-line text-message-ink">{message.attachment?.name ?? message.plainText}</p>
    </div>
  );
}

