import { useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { workspacePageOf, type Message, type Room, type ShareWidening } from "@ember/protocol";
import { Lock, Xmark } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { useFlash } from "@/components/flash";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useNameOf } from "@/hooks/use-directory";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, forwardMessage, isSignedOut } from "@/lib/api";
import { MESSAGE_DELETED } from "@/lib/room-changes";
import { membersShown, roomName } from "@/lib/directs";
import { quotedTimeLabel } from "@/lib/messages";
import { roomDisplayName } from "@/lib/sub-rooms";
import { cn } from "@/lib/utils";
import { returnFocus } from "./dialog-openers";
import { ConversationsContext } from "./quote-cite";
import { ShareWarning, shareWidening, type SharePlace } from "./share-warning";
import { DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./dialog-styles";
import { UserAvatar } from "./user-avatar";

// Forward message, as Slack's is: pick a conversation you're in, or a thread in one by pasting a link to a
// message, add a note if you like, and the message goes there quoted, as Quote quotes one, naming where it's
// from. It lists the rooms the sidebar already has, so it searches as you type. Where the conversation picked
// reaches people who can't see the original, it asks first (share-warning.tsx). It shows only what forwarding
// needs: the field, the conversations, the note, what's forwarded, and why something didn't work.

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
  const phone = usePhoneLayout();
  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const forwardButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Destination | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // Whether Forward is asking who'd see it, or posting it, when it's busy, which only posting says.
  const [busy, setBusy] = useState<"checking" | "forwarding" | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Who the conversation picked would show the message to who can't see it now, while that's asked.
  const [widening, setWidening] = useState<ShareWidening | null>(null);
  // Whether the message has been deleted since it opened, which it says in place, keeping what's written.
  const [gone, setGone] = useState(false);

  const rooms = conversations?.rooms ?? [];
  const meId = conversations?.meId ?? "";
  // A conversation's name, and as text names it elsewhere, with a room's `#`.
  const named = (room: Room) => (room.kind === "direct" ? roomName(room, meId, nameOf) : roomDisplayName(room, rooms));
  const labeled = (room: Room) => (room.kind === "direct" ? named(room) : `#${named(room)}`);
  const destinations = useMemo(() => rooms.map((room) => ({ room, name: named(room) })), [rooms, meId, nameOf]);
  const linked = threadOfLink(typed, rooms);
  const options: Destination[] = linked
    ? [{ room: linked.room, name: `Thread in ${named(linked.room)}`, parentId: linked.parentId }]
    : matching(destinations, typed).slice(0, LISTED);
  const optionId = (destination: Destination) => `${listId}-${destinationKey(destination)}`;

  const close = () => {
    if (!busy) setOpen(false);
  };

  useEffect(() => {
    const deleted = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== message.id) return;
      setGone(true);
      setWidening(null);
    };
    window.addEventListener(MESSAGE_DELETED, deleted);
    return () => window.removeEventListener(MESSAGE_DELETED, deleted);
  }, [message.id]);

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

  // A pick moves on to the note, where what's next is written.
  const pick = (destination: Destination) => {
    if (busy) return;
    setPicked(destination);
    setTyped("");
    setHighlighted(null);
    setFailure(null);
    requestAnimationFrame(() => noteField.current?.focus());
  };

  const unpick = () => {
    if (busy) return;
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

  /** Where a conversation is, as the warning names it: "#design", a private room's name after a lock, or a DM's people. */
  const place = (room: Room): SharePlace => ({ label: labeled(room), direct: room.kind === "direct", closed: room.kind === "closed" });

  const failed = (error: unknown) => {
    if (isSignedOut(error)) flash("alert", "You’ve been signed out.");
    if (!mounted.current) return;
    setBusy(null);
    if (error instanceof ApiError && error.status === 422) setFailure(error.message);
    // Either conversation can be gone for them by now, as when they've been taken out of it, or the message.
    else if (error instanceof ApiError && error.status === 404) setFailure("That conversation or message isn’t there for you any more.");
    else setFailure("Couldn’t forward the message. Please try again.");
  };

  const forward = async (to: Destination) => {
    setBusy("forwarding");
    setFailure(null);
    try {
      await forwardMessage(message.roomId, message.id, { to: to.room.id, parentId: to.parentId, note, clientMessageId: crypto.randomUUID() });
      flash("notice", to.parentId ? `Message forwarded to a thread in ${labeled(to.room)}` : `Message forwarded to ${labeled(to.room)}`);
      if (mounted.current) {
        setBusy(null);
        setOpen(false);
      }
    } catch (error) {
      failed(error);
    }
  };

  // Forward asks first where the conversation reaches people who can't see the original.
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!picked || busy || gone) return;
    setBusy("checking");
    setFailure(null);
    let check: Awaited<ReturnType<typeof shareWidening>>;
    try {
      check = await shareWidening(message.roomId, picked.room.id);
    } catch (error) {
      return failed(error);
    }
    if (!mounted.current) return;
    if (check?.widens) {
      setBusy(null);
      setWidening(check);
      return;
    }
    await forward(picked);
  };

  // Asked again as the warning's Forward is pressed, as who's in either conversation may have changed while it
  // was open: the warning says so again where who'd see it now differs.
  const confirm = async (to: Destination, shown: ShareWidening) => {
    setBusy("checking");
    const now = await shareWidening(message.roomId, to.room.id).catch(() => undefined);
    if (!mounted.current) return;
    if (gone) return setBusy(null);
    if (now?.widens && (now.newViewers !== shown.newViewers || now.names.join() !== shown.names.join())) {
      setBusy(null);
      return setWidening(now);
    }
    setWidening(null);
    await forward(to);
  };

  const status = gone
    ? "This message was deleted."
    : busy === "forwarding"
      ? "Forwarding…"
      : (failure ?? (!picked && options.length === 0 ? "No conversations found." : null));
  const source = conversations?.rooms.find((room) => room.id === message.roomId);
  const forwardControl = (
    <button
      ref={forwardButton}
      type="submit"
      aria-disabled={!picked || busy !== null || gone || undefined}
      className={
        phone
          ? // A phone's is its header's text, as iOS's sheets' are.
            "min-h-11 cursor-pointer justify-self-end px-1 text-[17px] font-semibold text-link aria-disabled:cursor-default aria-disabled:text-muted-foreground"
          : cn(MAIN_ACTION, "aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:grayscale aria-disabled:contrast-50")
      }
    >
      Forward
    </button>
  );
  const cancelControl = (
    <button type="button" onClick={close} className={phone ? "min-h-11 cursor-pointer justify-self-start px-1 text-[17px]" : OTHER_ACTION}>
      Cancel
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(open) => open || close()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        overlayClassName={DIALOG_BACKDROP}
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
          "block p-0 text-foreground",
          // A phone's is the whole screen, a sheet with its actions at the top; elsewhere a card held near the top,
          // which doesn't move as the list under the field grows and shrinks.
          phone
            ? "inset-0 h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 overflow-auto rounded-none border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:max-w-none"
            : "top-[12dvh] w-[540px] max-w-[calc(100dvw-24px)] translate-y-0 overflow-auto rounded-[18px] shadow-[0_24px_80px_var(--color-dialog-shadow)] sm:max-w-[calc(100dvw-24px)] max-h-[76dvh]",
        )}
      >
        <form onSubmit={(event) => void submit(event)}>
          {phone ? (
            <header className="grid min-h-11 grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-4">
              {cancelControl}
              <DialogTitle className="truncate text-[17px] font-semibold">Forward message</DialogTitle>
              {forwardControl}
            </header>
          ) : (
            <DialogTitle className={cn(DIALOG_TITLE, "px-6 pt-6 pb-2.5")}>Forward message</DialogTitle>
          )}

          {picked ? (
            <div className="mx-6 flex min-h-[46px] items-center upto-500px:mx-4 max-md:mt-3">
              <button
                type="button"
                aria-label={`Remove ${picked.name}`}
                onClick={unpick}
                className="inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-[20px] border bg-surface py-[7px] ps-2.5 pe-2.5 text-[13px] text-foreground wrap-anywhere touch:min-h-11"
              >
                <RoomMark room={picked.room} meId={meId} />
                {picked.name}
                <Xmark className="size-4 flex-none" />
              </button>
            </div>
          ) : (
            <label className="mx-6 flex min-h-[46px] cursor-text items-center gap-2.5 rounded-[10px] border px-3 py-2.5 focus-within:border-muted-foreground focus-within:ring-1 focus-within:ring-muted-foreground upto-500px:mx-4 max-md:mt-3">
              <span className="sr-only">Search conversations</span>
              <input
                ref={search}
                type="text"
                value={typed}
                placeholder={phone ? "Search or paste a message link" : "Search for a conversation, or paste a message link"}
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
            <div tabIndex={-1} className="max-h-[min(280px,34dvh)] min-h-[120px] overflow-y-auto overscroll-contain px-4 pt-3.5 pb-2 outline-none">
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
                    <RoomMark room={option.room} meId={meId} />
                    <span className="min-w-0 wrap-anywhere">{option.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Its line keeps its height, so what's under it doesn't move as it says something. */}
          <p role="status" className="mx-6 mt-2 min-h-4 text-xs text-muted-foreground upto-500px:mx-4">
            {status}
          </p>

          <div className="px-6 pt-1 upto-500px:px-4">
            <label className="block">
              <span className="sr-only">Note</span>
              <textarea
                ref={noteField}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a message"
                rows={2}
                className="block w-full resize-y rounded-[10px] border bg-transparent px-3 py-2.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-1 focus-visible:ring-muted-foreground touch:resize-none touch:text-base"
              />
            </label>
            {!gone && <ForwardedPreview message={message} source={source ?? null} meId={meId} />}
          </div>

          {!phone && (
            <footer className="mt-5 flex justify-end gap-2.5 border-t px-6 py-[18px]">
              {cancelControl}
              {forwardControl}
            </footer>
          )}
        </form>
        {widening !== null && picked && (
          <ShareWarning
            source={source ? place(source) : { label: "this conversation", direct: false }}
            target={place(picked.room)}
            widening={widening}
            subject="message"
            confirm="Forward"
            verb="Forward"
            onShare={() => void confirm(picked, widening)}
            onCancel={() => setWidening(null)}
            onReturnFocus={() => forwardButton.current?.focus({ preventScroll: true })}
            // Over Forward message's own backdrop.
            overlayClassName="bg-transparent"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A conversation's mark, as the sidebar marks it: a room's icon, a lock for a private room without one, or a
 * DM's first other person's face.
 */
function RoomMark({ room, meId }: { room: Room; meId: string }) {
  if (room.kind === "direct") {
    const [person] = membersShown(room, meId);
    return person ? <UserAvatar user={person} square className="size-5 shrink-0 rounded-[4px]" /> : null;
  }
  if (room.kind === "closed" && room.icon === null) return <Lock aria-hidden="true" className="size-[18px] shrink-0 text-muted-foreground" />;
  return <RoomIcon icon={room.icon} size={18} className="w-[18px] shrink-0 text-center text-[20px] leading-none text-muted-foreground" />;
}

/**
 * What's being forwarded, as its quote will show it: its author and the start of its text, or its file's name,
 * and in a muted line under them, the conversation it's from and when it was written.
 */
function ForwardedPreview({ message, source, meId }: { message: Message; source: Room | null; meId: string }) {
  const nameOf = useNameOf();
  const rooms = useContext(ConversationsContext)?.rooms ?? [];
  // Named as the warning names it: "#general", a private room's name after its lock, or "DM with" its people.
  const from = source && (source.kind === "direct" ? `DM with ${roomName(source, meId, nameOf)}` : `${source.kind === "open" ? "#" : ""}${roomDisplayName(source, rooms)}`);
  return (
    <div className="mt-3 border-s-[0.5ch] border-muted-foreground ps-[1.5ch] text-sm max-md:text-[15px]">
      <p className="font-semibold text-message-ink">{nameOf(message.creator)}</p>
      <p className="line-clamp-3 whitespace-pre-line text-message-ink">{message.attachment?.name ?? message.plainText}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
        {source && source.kind === "closed" && <Lock aria-label="Private" className="size-3 shrink-0" />}
        {from && <span className="min-w-0 truncate">{from}</span>}
        {from && <span aria-hidden="true">·</span>}
        <time dateTime={message.createdAt}>{quotedTimeLabel(new Date(message.createdAt))}</time>
      </p>
    </div>
  );
}
