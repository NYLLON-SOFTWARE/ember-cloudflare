import { useEffect, useEffectEvent, useRef, useState } from "react";
import { MAX_CANVAS_STEPS, MAX_ROOM_FRAME_SIZE, type ClientFrame, type User } from "@ember/protocol";
import { CANVAS_GONE, CANVAS_TOO_LONG, MAX_CANVAS_LENGTH, type Canvas } from "@ember/protocol/library";
import type { Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep, Step, type Mappable } from "@tiptap/pm/transform";
import { collab, getVersion, receiveTransaction, sendableSteps } from "prosemirror-collab";
import type { RoomFrames } from "@/hooks/use-room";
import { mergeCanvas } from "@/lib/canvas-merge";
import { forgetUnsaved, keepUnsaved } from "@/lib/canvas-unsaved";

// Writing a canvas together, over the room's socket, after ProseMirror's collab: the editor sends the
// steps it makes, a tenth of a second's at a time, over the version it has, and the room, the one
// authority, applies them in turn and sends them to everyone writing it, the sender too, which confirms
// them. Steps from others are applied as they come, and steps of its own that the room hasn't taken yet
// are rebased over them and sent again. A room that has lost the steps since the version here, as one
// that restarted, sends the canvas whole, which what's here is merged into (canvas-merge.ts), so nothing
// written is lost while the socket is away. Steps wait while it is, and go once it's back, even once the
// canvas has closed (part, below).

/** How long the editor gathers steps before it sends them: a few keys a message, which each wakes the room. */
const SEND_EVERY_MS = 250;
/** How long a send waits for the room before the editor sends again, as one lost with its socket may have been. */
const CONFIRM_WITHIN_MS = 5_000;
/** How many of the latest versions the room confirmed an editor keeps, ProseMirror's documents sharing what they don't change. */
const KEPT_VERSIONS = 1_000;
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
  /** Says what was written here, as a paste, was too long for the canvas, and was left out. */
  onTooLong: () => void;
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

const utf8 = new TextEncoder();
/** How many bytes `text` takes as the room counts a frame's, in UTF-8. */
const bytesOf = (text: string) => utf8.encode(text).byteLength;

/**
 * The frame that sends `steps` over `version`, or as many of the first of them as the room takes in one, up
 * to `MAX_CANVAS_STEPS` and under its frame limit, past which it closes the socket rather than read it; or
 * null when not even the first fits, which no frame could carry.
 */
function stepsFrame(tabId: string, version: number, clientId: string, steps: readonly Step[]): ClientFrame | null {
  const frame = { type: "canvas.steps" as const, tabId, version, clientId, steps: [] as unknown[] };
  let size = bytesOf(JSON.stringify(frame));
  for (const step of steps.slice(0, MAX_CANVAS_STEPS)) {
    const json = step.toJSON() as unknown;
    size += bytesOf(JSON.stringify(json)) + (frame.steps.length > 0 ? 1 : 0);
    if (size > MAX_ROOM_FRAME_SIZE) break;
    frame.steps.push(json);
  }
  return frame.steps.length > 0 ? frame : null;
}

/** A step's JSON past which writing it here weighs the canvas whole: a paste, say, rather than typing. */
const LARGE_STEP_BYTES = 16_384;
/** The most a step's JSON can take, leaving room in a frame for what wraps it. */
const MAX_STEP_BYTES = MAX_ROOM_FRAME_SIZE - 1_024;

/**
 * Whether `tr`, written here, as a paste or a merge, would leave the canvas too long to save, or hold a step
 * too big for any frame to the room. Typing is only measured key by key.
 */
function tooLong(tr: Transaction): boolean {
  if (!tr.docChanged || tr.getMeta(FROM_ROOM) === true) return false;
  const sizes = tr.steps.map((step) => bytesOf(JSON.stringify(step.toJSON())));
  if (sizes.every((size) => size < LARGE_STEP_BYTES)) return false;
  return sizes.some((size) => size > MAX_STEP_BYTES) || JSON.stringify(tr.doc.toJSON()).length > MAX_CANVAS_LENGTH;
}

/** An insertion here the room hasn't taken, which stays before someone else's at the very spot as it's rebased. */
class OwnInsertion extends ReplaceStep {
  override map(mapping: Mappable): ReplaceStep | null {
    const at = mapping.mapResult(this.from, -1);
    return at.deletedAcross ? null : new ReplaceStep(at.pos, at.pos, this.slice);
  }
}

/** The steps an editor has written that the room hasn't taken, as prosemirror-collab keeps them. */
const unconfirmedOf = (state: EditorState) =>
  (state.plugins.find((plugin) => (plugin as unknown as { key: string }).key === "collab$")?.getState(state) as { unconfirmed: Array<{ step: Step }> } | undefined)?.unconfirmed ?? [];

/**
 * Takes in `steps`, which the room applied, from the editors `clientIds` names, rebasing what's
 * here that it hasn't taken over them. Keys here waiting for the room stay before someone else's writing at
 * the very spot, as the cursor does, beside the keys before them, so two people typing at one spot each
 * keep their run whole rather than having their keys interleave (D6).
 */
export function fromRoom(state: EditorState, steps: readonly Step[], clientIds: string[]): Transaction {
  for (const pending of unconfirmedOf(state)) {
    const { step } = pending;
    if (step instanceof ReplaceStep && !(step instanceof OwnInsertion) && step.from === step.to) pending.step = new OwnInsertion(step.from, step.to, step.slice);
  }
  return receiveTransaction(state, [...steps], clientIds, { mapSelectionBackward: true });
}

/** Ends what's still sending the steps a canvas closed with, by tab, as it opens again here. */
const parting = new Map<string, () => void>();

/**
 * Keeps sending the steps an editor closed with, those of its last state, until the room confirms them, as one
 * that closed while the room's socket was away, or before the room answered, would otherwise lose them. This
 * browser keeps them meanwhile too, in case the page goes first, or the canvas opens here again, which merges
 * them in.
 */
function part(frames: RoomFrames, tabId: string, clientId: string, state: EditorState, confirmed: Node) {
  keepUnsaved(tabId, { base: JSON.stringify(confirmed.toJSON()), body: JSON.stringify(state.doc.toJSON()), version: getVersion(state), sent: false });
  let waiting: ReturnType<typeof setTimeout> | null = null;
  const join = () => frames.send({ type: "canvas.join", tabId, version: getVersion(state) });
  const send = () => {
    if (waiting) clearTimeout(waiting);
    waiting = null;
    const sendable = sendableSteps(state);
    if (!sendable) return end(true);
    const frame = stepsFrame(tabId, sendable.version, clientId, sendable.steps);
    // One no frame could carry would only have the room close the socket each time: the copy kept here stays.
    if (!frame) return end(false);
    if (frames.send(frame)) waiting = setTimeout(send, CONFIRM_WITHIN_MS);
  };
  /** Stops, forgetting the kept copy once the room has every step. */
  const end = (confirmedAll: boolean) => {
    stop();
    if (waiting) clearTimeout(waiting);
    parting.delete(tabId);
    if (!confirmedAll) return;
    forgetUnsaved(tabId);
    frames.send({ type: "canvas.leave", tabId });
  };
  const stop = frames.listen((frame) => {
    if (frame.type === "welcome" || frame.type === "resumed") return void join();
    if (!("tabId" in frame) || frame.tabId !== tabId) return;
    if (frame.type === "canvas.steps") {
      const here = getVersion(state);
      if (frame.version > here) return void join();
      const fresh = frame.steps.slice(here - frame.version).map((json) => Step.fromJSON(state.schema, json));
      if (fresh.length > 0) state = state.apply(fromRoom(state, fresh, frame.clientIds.slice(here - frame.version)));
      return send();
    }
    // A room that lost its steps sends the canvas whole, and the copy kept here is merged in as the canvas
    // next opens; one that's been deleted leaves nothing to keep.
    if (frame.type === "canvas.refused" && frame.message === CANVAS_GONE) forgetUnsaved(tabId);
    end(false);
  });
  parting.set(tabId, () => end(false));
  send();
}

export function useLiveCanvas({ editor, frames, tabId, version, onEdited, onMerged, onRefused, onTooLong }: Options): LiveCanvas {
  const [offline, setOffline] = useState(false);
  const handle = useRef({ flush: () => version, confirmed: (): string | null => null });
  const edited = useEffectEvent(onEdited);
  const merged = useEffectEvent(onMerged);
  const refused = useEffectEvent(onRefused);
  const leftOut = useEffectEvent(onTooLong);

  useEffect(() => {
    if (!editor || !frames) return;
    const clientId = crypto.randomUUID();
    // Steps this canvas closed with stop going on their own: what this browser kept of them is merged in instead.
    parting.get(tabId)?.();
    // The document as the room has it at the version here, which what's here is merged from.
    let confirmed: Node = editor.state.doc;
    // And at each version lately, for a room that restarted behind it (resync).
    const history = new Map<number, Node>([[version, confirmed]]);
    const remember = (at: number, doc: Node) => {
      history.set(at, doc);
      if (history.size > KEPT_VERSIONS) history.delete(history.keys().next().value!);
    };
    editor.registerPlugin(collab({ version, clientID: clientId }));
    // What's too long to send never goes in, rather than have the room close the socket over it, again each time it's back.
    const guard = new PluginKey("emberCanvasTooLong");
    editor.registerPlugin(
      new Plugin({
        key: guard,
        filterTransaction: (tr) => {
          if (!tooLong(tr)) return true;
          leftOut();
          return false;
        },
      }),
    );
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
      const frame = stepsFrame(tabId, sendable.version, clientId, sendable.steps);
      // One no frame could carry, which the editor refuses as it's written, is never sent: the room would
      // only close the socket, and again each time it came back.
      if (!frame) return refused(CANVAS_TOO_LONG);
      if (!frames.send(frame)) return setOffline(true);
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
      fresh.forEach((step, at) => {
        confirmed = step.apply(confirmed).doc ?? confirmed;
        remember(here + at + 1, confirmed);
      });
      editor.view.dispatch(fromRoom(editor.state, fresh, clientIds.slice(here - from)).setMeta(FROM_ROOM, true));
      return true;
    };

    /** Starts again from the canvas as the room has it, `canvas`, with what's here merged in. */
    const resync = (canvas: Canvas) => {
      // A room behind what it confirmed here, as one that restarted before saving it, lost what's past its
      // version, which is merged in as written here, from the canvas as it was here at that version, or from
      // the room's, once that's too long ago.
      const behind = canvas.version < getVersion(editor.state);
      const base = behind ? (history.get(canvas.version)?.toJSON() ?? JSON.parse(canvas.body)) : confirmed.toJSON();
      const merge = mergeCanvas(JSON.stringify(base), JSON.stringify(editor.getJSON()), canvas.body);
      editor.unregisterPlugin("collab");
      showDocument(editor, canvas.body, FROM_ROOM);
      confirmed = editor.state.doc;
      history.clear();
      remember(canvas.version, confirmed);
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
      editor.unregisterPlugin(guard);
      if (timer) clearTimeout(timer);
      settle();
      // What's left goes on until the room has it, then the canvas is let go, which the room saves once nobody
      // else is writing it.
      if (sendableSteps(editor.state)) part(frames, tabId, clientId, editor.state, confirmed);
      else frames.send({ type: "canvas.leave", tabId });
    };
  }, [editor, frames, tabId]);

  return {
    pending: () => editor !== null && frames !== null && sendableSteps(editor.state) !== null,
    offline,
    flush: () => handle.current.flush(),
    confirmed: () => handle.current.confirmed(),
  };
}
