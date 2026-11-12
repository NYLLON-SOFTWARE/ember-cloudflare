import { useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react";
import { type Message } from "@ember/protocol";
import type { DisplayNode } from "@ember/richtext/dom";
import { Copy, Edit } from "@/components/icons/iconoir";
import { OVERLAPPING } from "@/components/workspace/message-actions-menu";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { useLongPress } from "./use-long-press";
import { RarePage } from "@/components/workspace/rare-pages";

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

export interface Props {
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
export type Shown = "actions" | "reactions" | "delete" | null;

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
      {/* They load as they first open, with the pages few visits need. */}
      {rendered && (
        <RarePage
          show={({ MessageSheets }) => (
            <MessageSheets {...props} shown={shown} onShow={setShown} options={options} afterClosing={(then) => (next.current = then)} onCloseAutoFocus={closed} />
          )}
          loading={null}
        />
      )}
    </>
  );
}
