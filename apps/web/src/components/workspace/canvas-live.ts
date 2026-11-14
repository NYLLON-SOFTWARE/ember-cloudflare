import { useEffect, useEffectEvent, useRef, useState } from "react";
import { MAX_CANVAS_STEPS, type User } from "@ember/protocol";
import type { Canvas } from "@ember/protocol/library";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Step } from "@tiptap/pm/transform";
import { collab, getVersion, receiveTransaction, sendableSteps } from "prosemirror-collab";
import type { RoomFrames } from "@/hooks/use-room";
import { mergeCanvas } from "@/lib/canvas-merge";

// Writing a canvas together, over the room's socket, after ProseMirror's collab: the editor sends the
// steps it makes, a tenth of a second's at a time, over the version it has, and the room, the one
// authority, applies them in turn and sends them to everyone writing it, the sender too, which confirms
// them. Steps from others are applied as they come, and steps of its own that the room hasn't taken yet
// are rebased over them and sent again. A room that has lost the steps since the version here, as one
// that restarted, sends the canvas whole, which what's here is merged into (canvas-merge.ts), so nothing
// written is lost while the socket is away. Steps wait while it is, and go once it's back.

/** How long the editor gathers steps before it sends them: a few keys a message, which each wakes the room. */
const SEND_EVERY_MS = 250;
/** How long a send waits for the room before the editor sends again, as one lost with its socket may have been. */
const CONFIRM_WITHIN_MS = 5_000;
/** Marks the transactions that take in what the room sends, which aren't this person's writing. */
export const FROM_ROOM = "emberCanvasFromRoom";
/** Marks the transactions that merge someone else's canvas into what's here, which aren't this person's writing either. */
export const MERGED = "emberCanvasMerged";

/**
 * Shows `body` in `editor`, changing only what differs, outside its undo history, so Undo can't take back
 * someone else's writing, marked `meta`.
 */
export function showDocument(editor: Editor, body: string, meta: string) {
  const { state } = editor;
  const next = editor.schema.nodeFromJSON(JSON.parse(body));
  const start = state.doc.content.findDiffStart(next.content);
  if (start === null) return;
  let { a: endHere, b: endThere } = state.doc.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(endHere, endThere);
  if (overlap > 0) {
    endHere += overlap;
    endThere += overlap;
  }
  editor.view.dispatch(state.tr.replace(start, endHere, next.slice(start, endThere)).setMeta("addToHistory", false).setMeta(meta, true));
}

/** The latest change the room has confirmed, and who made it. */
export interface Edited {
  by: User;
  at: string;
  version: number;
}

interface Options {
  editor: Editor | null;
  /** The room's socket, or null where the canvas is saved whole instead. */
  frames: RoomFrames | null;
  tabId: string;
  /** The version the canvas opened at. */
  version: number;
  onEdited: (edited: Edited) => void;
  /** Says the room's canvas was merged into what's here, with how many places were both people's. */
  onMerged: (conflicts: number) => void;
  /** Says why the room refused steps from here. */
  onRefused: (message: string) => void;
}

/** What writing together does to the editor: whether it's waiting for the room, and how to send what's left as the page goes. */
export interface LiveCanvas {
  /** Whether there are steps here the room hasn't confirmed. */
  pending: () => boolean;
  /** Whether the room's socket is away, with steps here waiting for it. */
  offline: boolean;
  /** Sends what's waiting at once, as the page goes, answering the version the room has confirmed. */
  flush: () => number;
  /** The document as the room has confirmed it, or null before the canvas is written together. */
  confirmed: () => string | null;
}

export function useLiveCanvas({ editor, frames, tabId, version, onEdited, onMerged, onRefused }: Options): LiveCanvas {
  const [offline, setOffline] = useState(false);
  const handle = useRef({ flush: () => version, confirmed: (): string | null => null });
  const edited = useEffectEvent(onEdited);
  const merged = useEffectEvent(onMerged);
  const refused = useEffectEvent(onRefused);

  useEffect(() => {
    if (!editor || !frames) return;
    const clientId = crypto.randomUUID();
    // The document as the room has it at the version here, which what's here is merged from.
    let confirmed: Node = editor.state.doc;
    editor.registerPlugin(collab({ version, clientID: clientId }));
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waiting: ReturnType<typeof setTimeout> | null = null;

    const settle = () => {
      if (waiting) clearTimeout(waiting);
      waiting = null;
    };
    const sendNow = () => {
      timer = null;
      const sendable = sendableSteps(editor.state);
      if (!sendable || waiting) return;
      const steps = sendable.steps.slice(0, MAX_CANVAS_STEPS).map((step) => step.toJSON() as unknown);
      if (!frames.send({ type: "canvas.steps", tabId, version: sendable.version, clientId, steps })) return setOffline(true);
      waiting = setTimeout(() => {
        waiting = null;
        sendNow();
      }, CONFIRM_WITHIN_MS);
    };
    const sendSoon = () => {
      timer ??= setTimeout(sendNow, SEND_EVERY_MS);
    };
    const join = () => frames.send({ type: "canvas.join", tabId, version: getVersion(editor.state) });

    /** Takes in steps the room applied over `from`, those already here skipped, answering whether it could. */
    const receive = (from: number, steps: unknown[], clientIds: string[]) => {
      const here = getVersion(editor.state);
      if (from > here) return false;
      const fresh = steps.slice(here - from).map((json) => Step.fromJSON(editor.schema, json));
      if (fresh.length === 0) return true;
      for (const step of fresh) confirmed = step.apply(confirmed).doc ?? confirmed;
      editor.view.dispatch(receiveTransaction(editor.state, fresh, clientIds.slice(here - from), { mapSelectionBackward: true }).setMeta(FROM_ROOM, true));
      return true;
    };

    /** Starts again from the canvas as the room has it, `canvas`, with what's here merged in. */
    const resync = (canvas: Canvas) => {
      const merge = mergeCanvas(JSON.stringify(confirmed.toJSON()), JSON.stringify(editor.getJSON()), canvas.body);
      editor.unregisterPlugin("collab");
      showDocument(editor, canvas.body, FROM_ROOM);
      confirmed = editor.state.doc;
      editor.registerPlugin(collab({ version: canvas.version, clientID: clientId }));
      if (merge.body !== canvas.body) {
        // Written here, as the room hasn't it, but outside the undo history, as Undo would take theirs too.
        showDocument(editor, merge.body, MERGED);
        merged(merge.conflicts);
      }
      edited({ by: canvas.updatedBy, at: canvas.updatedAt, version: canvas.version });
      sendSoon();
    };

    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; getMeta: (key: string) => unknown } }) => {
      if (transaction.docChanged && transaction.getMeta(FROM_ROOM) !== true) sendSoon();
    };
    editor.on("transaction", onTransaction);
    const stop = frames.listen((frame) => {
      // The socket is back: the room sends what's changed since the version here.
      if (frame.type === "welcome" || frame.type === "resumed") {
        setOffline(false);
        settle();
        join();
        return;
      }
      if (!("tabId" in frame) || frame.tabId !== tabId) return;
      settle();
      setOffline(false);
      if (frame.type === "canvas.steps") {
        if (!receive(frame.version, frame.steps, frame.clientIds)) return void join();
        edited({ by: frame.updatedBy, at: frame.updatedAt, version: getVersion(editor.state) });
        sendSoon();
      } else if (frame.type === "canvas.state") resync(frame.canvas);
      else if (frame.type === "canvas.refused") refused(frame.message);
    });
    join();
    handle.current = {
      flush: () => {
        if (timer) clearTimeout(timer);
        settle();
        sendNow();
        return getVersion(editor.state);
      },
      confirmed: () => JSON.stringify(confirmed.toJSON()),
    };

    return () => {
      stop();
      editor.off("transaction", onTransaction);
      if (timer) clearTimeout(timer);
      settle();
      // What's left goes, then the canvas is let go, which the room saves once nobody else is writing it.
      sendNow();
      frames.send({ type: "canvas.leave", tabId });
    };
  }, [editor, frames, tabId]);

  return {
    pending: () => editor !== null && frames !== null && sendableSteps(editor.state) !== null,
    offline,
    flush: () => handle.current.flush(),
    confirmed: () => handle.current.confirmed(),
  };
}
