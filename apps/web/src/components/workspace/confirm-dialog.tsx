import { useCallback, useState, type ReactNode } from "react";
import type { Message } from "@ember/protocol";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useNameOf } from "@/hooks/use-directory";
import { timeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { DIALOG, DIALOG_BACKDROP, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./dialog-styles";
import { UserAvatar } from "./user-avatar";

interface Props {
  title: string;
  /** What it's about, as the dialog shows it under its title, unless the title says it all. */
  children?: ReactNode;
  /** What the button that goes ahead says, red where it can't be undone. */
  confirm: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Cancel, Escape or the backdrop. */
  onCancel: () => void;
  /** Once it's closed, either way, which is when focus can move, as it can't out of the dialog while it's open. */
  onClosed?: () => void;
}

/**
 * Asks before going ahead, as the app's own dialog rather than the browser's `confirm()`, which shows the
 * page's address for a title, holds up the page until it's answered and can't show what it's about: Cancel,
 * which has focus, and the button that goes ahead. Escape cancels.
 */
export function ConfirmDialog({ title, children, confirm, destructive = false, onConfirm, onCancel, onClosed }: Props) {
  return (
    <Dialog open onOpenChange={(open) => open || onCancel()}>
      <DialogContent
        role="alertdialog"
        showCloseButton={false}
        overlayClassName={DIALOG_BACKDROP}
        className={cn(DIALOG, "w-[440px]")}
        // Where focus goes next is the asker's to say, as what opened it may have gone with what it confirmed.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed?.();
        }}
      >
        <DialogTitle className={DIALOG_TITLE}>{title}</DialogTitle>
        {children !== undefined && (
          <DialogDescription asChild>
            <div>{children}</div>
          </DialogDescription>
        )}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className={OTHER_ACTION}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={cn(MAIN_ACTION, destructive && "bg-negative-button text-white")}>
            {confirm}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface Question {
  /** A line under the title, only for what going ahead does that the title doesn't say: "This can’t be undone." */
  body?: string;
  /** What the button that goes ahead says, OK unless it's given. */
  confirm?: string;
  /** Red, for what can't be undone. */
  destructive?: boolean;
}

interface Asking extends Required<Omit<Question, "body">>, Pick<Question, "body"> {
  title: string;
  answer: (yes: boolean) => void;
  closed: () => void;
}

/**
 * `confirm()` as the app's own dialog: `ask` titles it with `title`, as Slack does, the verb and what it's
 * done to, "Delete #design", and says whether the button that goes ahead was pressed, or Cancel, Escape
 * or the backdrop, once the dialog has gone. Focus is back where it was when it asked, if that's still
 * there, before the answer comes, so what the asker does next with focus wins. The asker renders `dialog`.
 */
export function useConfirm(): [ask: (title: string, options?: Question) => Promise<boolean>, dialog: ReactNode] {
  const [asking, setAsking] = useState<Asking | null>(null);
  const ask = useCallback(
    (title: string, { body, confirm = "OK", destructive = false }: Question = {}) =>
      new Promise<boolean>((resolve) => {
        const opener = document.activeElement;
        let yes = false;
        setAsking({
          title,
          body,
          confirm,
          destructive,
          answer: (answer) => {
            yes = answer;
            setAsking(null);
          },
          closed: () => {
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
            resolve(yes);
          },
        });
      }),
    [],
  );
  const dialog = asking && (
    <ConfirmDialog
      title={asking.title}
      confirm={asking.confirm}
      destructive={asking.destructive}
      onConfirm={() => asking.answer(true)}
      onCancel={() => asking.answer(false)}
      onClosed={asking.closed}
    >
      {asking.body}
    </ConfirmDialog>
  );
  return [ask, dialog];
}

/** Delete message's dialog, as Slack's: the message as it'll go, its author, time and first three lines. */
export function DeleteMessageDialog({ message, onDelete, onCancel, onClosed }: { message: Message; onDelete: () => void; onCancel: () => void; onClosed?: () => void }) {
  const nameOf = useNameOf();
  return (
    <ConfirmDialog title="Delete message" confirm="Delete" destructive onConfirm={onDelete} onCancel={onCancel} onClosed={onClosed}>
      <div className="flex gap-2.5 rounded-[10px] border p-3 text-left text-message-ink">
        <UserAvatar user={message.creator} square className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="flex items-baseline gap-2 text-[15px]">
            <span className="truncate font-bold">{nameOf(message.creator)}</span>
            <time dateTime={message.createdAt} className="shrink-0 text-xs text-message-muted">
              {timeLabel(new Date(message.createdAt))}
            </time>
          </p>
          <p className="line-clamp-3 text-[15px] leading-[22px] wrap-anywhere whitespace-pre-wrap">{message.attachment?.name ?? message.plainText}</p>
        </div>
      </div>
    </ConfirmDialog>
  );
}
