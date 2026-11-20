import { useRef, useState } from "react";
import type { NotifiedCounts } from "@ember/protocol";
import { mentionsIn, SPECIAL_MENTIONS, type SpecialMention } from "@ember/richtext/dom";
import { AtSign, Xmark } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAccount } from "@/hooks/use-account";
import { useMounted } from "@/hooks/use-mounted";
import { fetchNotified } from "@/lib/api";
import { DIALOG, DIALOG_BACKDROP, DIALOG_CLOSE, DIALOG_TITLE, MAIN_ACTION, OTHER_ACTION } from "./unsaved-changes";

/** How many people a room holds, its writer too, from which a message notifying it asks first, as Slack asks in a channel of six or more. */
export const ASKS_FROM_MEMBERS = 6;

/** What the dialog says each special mention does, in room `room`. */
const DOES: Record<SpecialMention, (room: string) => string> = {
  here: (room) => `@here notifies everyone active in #${room}.`,
  channel: (room) => `@channel notifies everyone in #${room}.`,
  everyone: () => "@everyone notifies everyone in the workspace.",
};

/** The widest of a message's special mentions that would notify its room, and how many people it would. */
interface Notifying {
  mention: SpecialMention;
  people: number;
}

/**
 * What to ask before `body` goes to a room `counts` tells of: its widest special mention that would
 * notify the room, and how many people that would notify, in a room of six or more where anyone would
 * be notified. Otherwise it goes without asking.
 */
export function askingFor(body: string, counts: NotifiedCounts): Notifying | null {
  if (counts.members < ASKS_FROM_MEMBERS) return null;
  const made = mentionsIn(body).specialMentions;
  const mention = SPECIAL_MENTIONS.findLast((mention) => made.includes(mention) && counts.mentions[mention] !== undefined);
  const people = mention === undefined ? 0 : (counts.mentions[mention] ?? 0);
  return mention !== undefined && people > 0 ? { mention, people } : null;
}

/** "1 person" or "14 people". */
const peopleCount = (people: number) => (people === 1 ? "1 person" : `${people.toLocaleString("en-US")} people`);

/**
 * Asks, before a message whose @channel, @here or @everyone would notify a room of six or more goes,
 * whether to send it, as Slack asks, unless the workspace has that off, or `asks` is false for a composer
 * whose messages notify nobody, as a thread's and a DM's. `confirm` sends what's written by `send` at
 * once when there's nothing to ask, as when the room's counts don't come, or once Send is pressed; Cancel
 * leaves it written. The composer shows `dialog`, which gives focus back by `onClosed` as it closes.
 */
export function useNotifyConfirm(roomId: string, roomName: string, asks: boolean, onClosed: () => void) {
  const { warnBeforeNotifying } = useAccount();
  // What the dialog asks, kept as it closes so that it doesn't empty while it fades.
  const [asking, setAsking] = useState<(Notifying & { send: () => void; open: boolean }) | null>(null);
  // While the room's counts are on their way, sending again waits for them.
  const checking = useRef(false);
  const mounted = useMounted();

  const confirm = (body: string, send: () => void) => {
    if (checking.current) return;
    if (!asks || !warnBeforeNotifying || mentionsIn(body).specialMentions.length === 0) return send();
    checking.current = true;
    void fetchNotified(roomId)
      .then(
        (counts) => askingFor(body, counts),
        () => null,
      )
      .then((notifying) => {
        checking.current = false;
        // Leaving the room meanwhile keeps the message as its draft.
        if (!mounted.current) return;
        if (notifying) setAsking({ ...notifying, send, open: true });
        else send();
      });
  };

  const close = () => setAsking((asking) => asking && { ...asking, open: false });
  const dialog = asking && (
    <NotifyConfirmDialog
      {...asking}
      roomName={roomName}
      onClosed={onClosed}
      onSend={() => {
        close();
        asking.send();
      }}
      onCancel={close}
    />
  );
  return { confirm, dialog };
}

interface DialogProps extends Notifying {
  open: boolean;
  roomName: string;
  onSend: () => void;
  onCancel: () => void;
  onClosed: () => void;
}

/**
 * "Notify 14 people?", with what the mention does, Cancel, and Send, which has focus, so that Enter sends
 * and Escape goes back to what's written, as the dialogs styled as Unsaved Changes look. Opened by no
 * button, it leaves focus to `onClosed` as it closes.
 */
function NotifyConfirmDialog({ mention, people, open, roomName, onSend, onCancel, onClosed }: DialogProps) {
  const sendButton = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(open) => open || onCancel()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName={DIALOG_BACKDROP}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          sendButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
        className={DIALOG}
      >
        <button type="button" aria-label="Close" onClick={onCancel} className={DIALOG_CLOSE}>
          <Xmark className="size-[18px]" />
        </button>
        <div aria-hidden="true" className="mb-5 grid size-[46px] place-items-center rounded-xl border bg-surface">
          <AtSign className="size-[22px]" />
        </div>
        <DialogTitle className={DIALOG_TITLE}>Notify {peopleCount(people)}?</DialogTitle>
        <DialogDescription className="leading-[1.65]">{DOES[mention](roomName)}</DialogDescription>
        <div className="mt-[26px] flex justify-end gap-2.5">
          <button type="button" onClick={onCancel} className={OTHER_ACTION}>
            Cancel
          </button>
          <button ref={sendButton} type="button" onClick={onSend} className={MAIN_ACTION}>
            Send
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
