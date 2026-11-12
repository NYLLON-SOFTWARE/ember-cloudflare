import { useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { QUICK_REACTION_COUNT, REACTIONS, type Message, type SavedList } from "@ember/protocol";
import type { DisplayNode } from "@ember/richtext/dom";
import { useOptionalFlash } from "@/components/flash";
import { ArrowRight, Bookmark, BookmarkSolid, CheckCircle, CheckCircleSolid, Copy, Edit, Link, MessageText, Plus, QuoteMessage, Trash } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { messageAddress, OVERLAPPING, useQuote } from "@/components/workspace/message-actions-menu";
import { DIALOG, DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "@/components/workspace/unsaved-changes";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { navigate } from "@/hooks/use-route";
import { toggleKept, useSavedMark } from "@/lib/saved";
import { cn } from "@/lib/utils";
import { ActionSheet, type SheetAction } from "./action-sheet";
import { CHOICE, ReactionSheet } from "./reaction-sheet";
import { useLongPress } from "./use-long-press";

/**
 * Whether messages have sheets in place of Message options: in the phone layout, unless with a mouse,
 * which can't press long and has the bar as wider screens do.
 */
export function useMessageSheets(): boolean {
  const phone = usePhoneLayout();
  const mouse = useMediaQuery(OVERLAPPING);
  return phone && !mouse;
}

export interface MessageSheetHandle {
  /** Focuses Message options, as sending a reaction does. */
  focus: () => void;
  /** Opens the sheet of reactions alone, as Add reaction does, handing focus back to `from` as it closes. */
  pickReaction: (from: HTMLElement) => void;
}

interface Props {
  message: Message;
  /** What the message shows, which Quote quotes. */
  nodes: DisplayNode[];
  /** The message's row, which a long press opens the sheet from. */
  row: RefObject<HTMLElement | null>;
  /** Whether Edit and Delete message show: on your own messages, and on everyone's for administrators. */
  editable: boolean;
  /** The address Reply in thread opens, or left out in a thread, whose own composer is there to reply in. */
  threadPath?: string;
  onReact: (emoji: string) => void;
  /** Writes a reply in the composer, given the quote it starts with. */
  onQuote: (quote: string) => void;
  onEdit: () => void;
  /** Deletes the message, answering whether the deletion was sent. */
  onDelete: () => boolean;
  /** Opens the message's Custom reaction form, from New boost. */
  onNewBoost: () => void;
  /** Opens Forward message for the message, given what opened it, or left out where it can't be forwarded. */
  onForward?: (opener: HTMLElement) => void;
  ref?: Ref<MessageSheetHandle>;
}

/** Which of the message's sheets is open: its actions, its reactions, or Delete message's question. */
type Shown = "actions" | "reactions" | "delete" | null;

/**
 * A phone's message actions, as Slack's are: a long press on the message opens a sheet of its quick
 * reactions and Add reaction, then Reply in thread, Forward message, Quote, Copy text, Copy link, Save and
 * Add to to-dos, and on messages you can change, Edit message and Delete message, which asks first. Nothing
 * shows on the message for them, but Message options, for screen readers and keyboards, opens the same.
 */
export function MessageSheet({ row, ref, ...props }: Props) {
  const [shown, setShown] = useState<Shown>(null);
  // Once opened, the sheets stay in the page while they're shut, so they can slide away.
  const [rendered, setRendered] = useState(false);
  const options = useRef<HTMLButtonElement>(null);
  // What opened the sheets, which takes focus again as they close, unless what was chosen took it. A long
  // press leaves focus where it was.
  const opener = useRef<HTMLElement | null>(null);
  // What was chosen opens, or focuses, once the sheet has gone, as an open sheet keeps focus in itself.
  const next = useRef<(() => void) | null>(null);

  const show = (sheet: Shown, from: HTMLElement | null) => {
    opener.current = from;
    setRendered(true);
    setShown(sheet);
  };

  useLongPress(row, () => show("actions", null));

  useImperativeHandle(ref, () => ({
    focus: () => options.current?.focus({ preventScroll: true }),
    pickReaction: (from) => show("reactions", from),
  }));

  const closed = (event: Event) => {
    event.preventDefault();
    const then = next.current;
    next.current = null;
    if (then) return then();
    const focused = document.activeElement;
    if (opener.current?.isConnected && (!focused || focused === document.body)) opener.current.focus({ preventScroll: true });
  };

  return (
    <>
      <button ref={options} type="button" aria-label="Message options" aria-haspopup="dialog" className="sr-only" onClick={(event) => show("actions", event.currentTarget)} />
      {rendered && <MessageSheets {...props} shown={shown} onShow={setShown} options={options} afterClosing={(then) => (next.current = then)} onCloseAutoFocus={closed} />}
    </>
  );
}

interface SheetsProps extends Omit<Props, "row" | "ref"> {
  shown: Shown;
  onShow: (sheet: Shown) => void;
  options: RefObject<HTMLButtonElement | null>;
  /** Does `then` once the sheet has gone. */
  afterClosing: (then: () => void) => void;
  onCloseAutoFocus: (event: Event) => void;
}

/** The sheets themselves, which read the people directory and saved lists only once they've opened. */
function MessageSheets({ message, nodes, editable, threadPath, onReact, onQuote, onEdit, onDelete, onNewBoost, onForward, shown, onShow, options, afterClosing, onCloseAutoFocus }: SheetsProps) {
  const quote = useQuote(message, nodes);
  const kept = useSavedMark(message.id)?.list;
  const flash = useOptionalFlash();
  // What Copy text copies: the message's plain text, which a file message has none of but its file's name.
  const text = message.attachment ? null : message.plainText;
  const closeOn = (open: boolean) => open || onShow(null);

  // The sheet has gone by the time the clipboard has it, so the flash says it's done.
  const copy = (copied: string, done: string) => {
    navigator.clipboard.writeText(copied).then(
      () => flash?.("notice", done),
      () => {},
    );
  };

  const keep = (list: SavedList) => {
    toggleKept(list, message.roomId, message.id).catch((error: unknown) => flash?.("alert", error instanceof Error ? error.message : String(error)));
  };

  const react = (emoji: string) => {
    onShow(null);
    onReact(emoji);
  };

  const actions: SheetAction[] = [];
  if (threadPath !== undefined) actions.push({ label: "Reply in thread", icon: <MessageText className="size-5" />, onSelect: () => navigate(threadPath) });
  if (onForward) actions.push({ label: "Forward message", icon: <ArrowRight className="size-5" />, onSelect: () => afterClosing(() => onForward(options.current!)) });
  // Quoting a file message would quote nothing, as its text is empty.
  if (!message.attachment) actions.push({ label: "Quote", icon: <QuoteMessage className="size-5" />, onSelect: () => afterClosing(() => onQuote(quote())) });
  if (text !== null) actions.push({ label: "Copy text", icon: <Copy className="size-5" />, onSelect: () => copy(text, "Text copied") });
  actions.push(
    { label: "Copy link", icon: <Link className="size-5" />, onSelect: () => copy(messageAddress(message), "Link copied") },
    {
      label: kept === "saved" ? "Remove from saved" : message.attachment ? "Save file" : "Save",
      icon: kept === "saved" ? <BookmarkSolid className="size-5" /> : <Bookmark className="size-5" />,
      onSelect: () => keep("saved"),
    },
    {
      label: kept === "todo" ? "Remove from to-dos" : "Add to to-dos",
      icon: kept === "todo" ? <CheckCircleSolid className="size-5" /> : <CheckCircle className="size-5" />,
      onSelect: () => keep("todo"),
    },
  );
  const changes: SheetAction[] = [];
  // The text of a file message, or of a bot's cards, can't be changed, so their editor would offer only Delete.
  if (editable && !message.attachment && !message.cards) changes.push({ label: "Edit message", icon: <Edit className="size-5" />, onSelect: onEdit });
  if (editable) changes.push({ label: "Delete message", icon: <Trash className="size-5" />, negative: true, onSelect: () => afterClosing(() => onShow("delete")) });

  return (
    <>
      <ActionSheet
        open={shown === "actions"}
        onOpenChange={closeOn}
        title="Message actions"
        titleHidden
        onCloseAutoFocus={onCloseAutoFocus}
        header={
          <div role="group" aria-label="Quick reactions" className="grid grid-cols-4 justify-items-center px-2 pt-1 pb-2">
            {REACTIONS.slice(0, QUICK_REACTION_COUNT).map(([emoji, title]) => (
              <button key={emoji} type="button" aria-label={title} className={CHOICE} onClick={() => react(emoji)}>
                <span aria-hidden>{emoji}</span>
              </button>
            ))}
            <button
              type="button"
              aria-label="Add reaction"
              className={CHOICE}
              onClick={() => {
                onShow(null);
                afterClosing(() => onShow("reactions"));
              }}
            >
              <Plus className="size-6 text-muted-foreground" />
            </button>
          </div>
        }
        actions={actions}
        more={changes}
      />
      <ReactionSheet open={shown === "reactions"} onOpenChange={closeOn} onCloseAutoFocus={onCloseAutoFocus} onReact={onReact} onNewBoost={() => afterClosing(onNewBoost)} />
      <Dialog open={shown === "delete"} onOpenChange={closeOn}>
        <DialogContent role="alertdialog" showCloseButton={false} overlayClassName={DIALOG_BACKDROP} onCloseAutoFocus={onCloseAutoFocus} className={DIALOG}>
          <DialogTitle className={DIALOG_TITLE}>Delete message?</DialogTitle>
          <DialogDescription className="leading-[1.65]">This can’t be undone.</DialogDescription>
          <div className="mt-[26px] flex justify-end gap-2.5">
            <button type="button" onClick={() => onShow(null)} className={OTHER_ACTION}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onShow(null);
                onDelete();
              }}
              className={cn(MAIN_ACTION, "bg-negative-button text-white")}
            >
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
