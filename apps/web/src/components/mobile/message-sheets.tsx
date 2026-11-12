import { type RefObject } from "react";
import { QUICK_REACTION_COUNT, REACTIONS, type Message, type SavedList } from "@ember/protocol";
import { useOptionalFlash } from "@/components/flash";
import { ArrowRight, Bookmark, BookmarkSolid, CheckCircle, CheckCircleSolid, Copy, Edit, Link, MessageText, Plus, QuoteMessage, Trash } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { messageAddress, useQuote } from "@/components/workspace/message-actions-menu";
import { DIALOG, DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "@/components/workspace/dialog-styles";
import { navigate } from "@/hooks/use-route";
import { toggleKept, useSavedMark } from "@/lib/saved";
import { cn } from "@/lib/utils";
import { ActionSheet, type SheetAction } from "./action-sheet";
import { CHOICE, ReactionSheet } from "./reaction-sheet";

import type { Props, Shown } from "./message-sheet";

// A phone's message sheets themselves (message-sheet.tsx), which load with the pages few visits need.

interface SheetsProps extends Omit<Props, "row" | "ref"> {
  shown: Shown;
  onShow: (sheet: Shown) => void;
  options: RefObject<HTMLButtonElement | null>;
  /** Does `then` once the sheet has gone. */
  afterClosing: (then: () => void) => void;
  onCloseAutoFocus: (event: Event) => void;
}

/** The sheets themselves, which read the people directory and saved lists only once they've opened. */
export function MessageSheets({ message, nodes, editable, threadPath, onReact, onQuote, onEdit, onDelete, onNewBoost, onForward, shown, onShow, options, afterClosing, onCloseAutoFocus }: SheetsProps) {
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
