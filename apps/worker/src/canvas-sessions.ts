import type { RoomId, ServerFrame, User } from "@ember/protocol";
import { CANVAS_GONE, CANVAS_TOO_LONG, MAX_CANVAS_LENGTH, type Canvas, type CanvasSave } from "@ember/protocol/library";
import type { CanvasDoc, CanvasEditing } from "./canvas-schema";

// People writing a canvas together, through the room's object, which is the one authority on the canvas
// while anyone has it open, after ProseMirror's collab: each change is a list of steps over the version
// its writer had, which the room applies in the order they come and sends everyone writing the canvas,
// the writer included, as confirmation. Steps over an older version are refused with those the writer
// missed, which their editor rebases its own over and sends again.
//
// The room keeps the document and its latest steps in memory while anyone writes, and saves the document
// to the Workspace and lets it go a few seconds after the writing stops, as well as saving it every so
// often while the writing goes on, and as the last writer leaves: not once a keystroke. Its alarm does
// that, not a timer, as a timer keeps the object awake and paid for between keystrokes, where the alarm
// lets it hibernate. The next change after that loads the canvas from the Workspace again. A writer whose
// version the room no longer has the steps after, as after the object restarts, is sent the canvas as
// it's saved, and merges what they had into it (canvas-merge.ts).

/** How long writing has to stop for before the room saves the canvas and lets it go. */
export const LET_GO_AFTER_MS = 5_000;
/** The longest the room goes without saving a canvas someone is writing in. */
const SAVE_AT_LEAST_EVERY_MS = 10_000;
/** How long the room waits to try again to save a canvas it couldn't. */
const RETRY_AFTER_MS = 1_000;
/** How many of a canvas's latest steps the room keeps for writers who are behind. */
const KEPT_STEPS = 1_000;
/** How big a document can grow, in ProseMirror's positions, about a character each, well inside `MAX_CANVAS_LENGTH`'s JSON. */
const MAX_CANVAS_SIZE = 100_000;

const CANT_APPLY = "That change couldn't be made to the canvas";

/** What saving a canvas sent whole answers: the canvas as it is now, or as it was saved since the version it went over. */
export type CanvasAnswer = { canvas: Canvas } | { conflict: Canvas } | "not found";

/** A canvas being written in, as the room holds it. */
interface Session {
  doc: CanvasDoc;
  version: number;
  /** The latest steps, as JSON, and whose they were, the last of them taking the document to `version`. */
  steps: Array<{ step: unknown; clientId: string }>;
  /** The version the Workspace has saved. */
  saved: number;
  updatedBy: User;
  updatedAt: string;
  /** When the latest change came. */
  changedAt: number;
  /** When the first change since the canvas was last saved came. */
  unsavedSince: number | null;
}

/** What the room gives its canvases: its sockets, the Workspace, and a way to run work in turn with its other events. */
export interface CanvasRoom {
  roomId: RoomId;
  /** The open sockets writing canvas `tabId`. */
  writers(tabId: string): WebSocket[];
  send(ws: WebSocket, frame: ServerFrame): void;
  /** Sets the room's alarm to ring by `time`, from within one of its events, to call `ring`. */
  ringBy(time: number): Promise<void>;
  load(tabId: string): Promise<Canvas | null>;
  keep(tabId: string, body: string, version: number, by: User): Promise<boolean>;
  /** Saves over `save.version` when nobody's writing the canvas together. */
  save(tabId: string, actor: User, save: CanvasSave): Promise<CanvasAnswer>;
}

export class CanvasSessions {
  private readonly sessions = new Map<string, Session>();
  private editing: Promise<CanvasEditing> | null = null;

  constructor(private readonly room: CanvasRoom) {}

  /** The editor's schema and steps, loaded the first time a canvas is written in, so a room that never is doesn't pay for them. */
  private tools(): Promise<CanvasEditing> {
    this.editing ??= import("./canvas-schema").then(({ canvasEditing }) => canvasEditing());
    return this.editing;
  }

  /** The session for canvas `tabId`, from the Workspace if nobody's been writing it, or null where the room has no such canvas. */
  private async session(tabId: string): Promise<Session | null> {
    const held = this.sessions.get(tabId);
    if (held) return held;
    const [canvas, tools] = await Promise.all([this.room.load(tabId), this.tools()]);
    if (!canvas) return null;
    // A canvas saved before the room checked documents holds only what the editor makes, as the server took
    // nothing else; one it can't read starts empty for nobody, and stays as it is.
    const doc = tools.docOf(canvas.body);
    if (!doc) return null;
    const session: Session = { doc, version: canvas.version, steps: [], saved: canvas.version, updatedBy: canvas.updatedBy, updatedAt: canvas.updatedAt, changedAt: Date.now(), unsavedSince: null };
    this.sessions.set(tabId, session);
    return session;
  }

  private canvasOf(session: Session): Canvas {
    return { body: JSON.stringify(session.doc.toJSON()), version: session.version, updatedBy: session.updatedBy, updatedAt: session.updatedAt };
  }

  /**
   * Sends `ws` what it needs to write canvas `tabId` from `version`: the steps since, if the room has them
   * all, or else the canvas as it is now.
   */
  private catchUp(ws: WebSocket, tabId: string, session: Session, version: number | undefined): void {
    const first = session.version - session.steps.length;
    if (version !== undefined && version >= first && version <= session.version) {
      const missed = session.steps.slice(version - first);
      this.room.send(ws, {
        type: "canvas.steps",
        tabId,
        version,
        steps: missed.map(({ step }) => step),
        clientIds: missed.map(({ clientId }) => clientId),
        updatedBy: session.updatedBy,
        updatedAt: session.updatedAt,
      });
    } else this.room.send(ws, { type: "canvas.state", tabId, canvas: this.canvasOf(session) });
  }

  /** Lets `ws` write canvas `tabId`, from `version` if its editor has one, answering whether the room has the canvas. */
  async join(ws: WebSocket, tabId: string, version: number | undefined): Promise<boolean> {
    const session = await this.session(tabId);
    if (!session) {
      this.room.send(ws, { type: "canvas.refused", tabId, message: CANVAS_GONE });
      return false;
    }
    this.catchUp(ws, tabId, session, version);
    return true;
  }

  /**
   * Applies `steps`, which `user` wrote over `version` in their editor `clientId`, and sends them to
   * everyone writing the canvas, or tells `ws` what it missed, or why the room refused them.
   */
  async apply(ws: WebSocket, user: User, tabId: string, version: number, clientId: string, steps: unknown[]): Promise<void> {
    const session = await this.session(tabId);
    if (!session) return this.room.send(ws, { type: "canvas.refused", tabId, message: CANVAS_GONE });
    if (version !== session.version) return this.catchUp(ws, tabId, session, version);
    const tools = await this.tools();
    const doc = tools.applied(session.doc, steps);
    if (!doc) {
      this.room.send(ws, { type: "canvas.refused", tabId, message: CANT_APPLY });
      return this.room.send(ws, { type: "canvas.state", tabId, canvas: this.canvasOf(session) });
    }
    if (doc.nodeSize > MAX_CANVAS_SIZE) return this.room.send(ws, { type: "canvas.refused", tabId, message: CANVAS_TOO_LONG });
    await this.advance(tabId, session, doc, steps, clientId, user);
  }

  /** Takes canvas `tabId` to `doc`, by `steps` from `clientId`'s editor, telling everyone writing it, and has the alarm save it. */
  private async advance(tabId: string, session: Session, doc: CanvasDoc, steps: unknown[], clientId: string, by: User): Promise<void> {
    const version = session.version;
    session.doc = doc;
    session.version += steps.length;
    session.steps.push(...steps.map((step) => ({ step, clientId })));
    if (session.steps.length > KEPT_STEPS) session.steps.splice(0, session.steps.length - KEPT_STEPS);
    session.updatedBy = by;
    session.updatedAt = new Date().toISOString();
    const frame: ServerFrame = { type: "canvas.steps", tabId, version, steps, clientIds: steps.map(() => clientId), updatedBy: by, updatedAt: session.updatedAt };
    for (const writer of this.room.writers(tabId)) this.room.send(writer, frame);
    session.changedAt = Date.now();
    // The alarm is set once a run of changes starts, and moves on as it rings, rather than once a change.
    if (session.unsavedSince === null) {
      session.unsavedSince = session.changedAt;
      await this.room.ringBy(session.changedAt + LET_GO_AFTER_MS);
    }
  }

  /**
   * Saves each canvas whose writing has stopped a while, or gone on a while unsaved, at `now`, letting go
   * of those whose writing has stopped, and answers when to ring again, if ever.
   */
  async ring(now = Date.now()): Promise<number | null> {
    let next: number | null = null;
    for (const [tabId, session] of [...this.sessions]) {
      const quiet = now - session.changedAt >= LET_GO_AFTER_MS;
      if (session.unsavedSince !== null && (quiet || now - session.unsavedSince >= SAVE_AT_LEAST_EVERY_MS)) await this.keep(tabId);
      if (!this.sessions.has(tabId)) continue;
      if (quiet && session.saved === session.version) {
        this.sessions.delete(tabId);
        continue;
      }
      const quietAt = session.changedAt + LET_GO_AFTER_MS;
      // A save that failed is tried again a moment later.
      const due = Math.max(now + RETRY_AFTER_MS, session.unsavedSince === null ? quietAt : Math.min(quietAt, session.unsavedSince + SAVE_AT_LEAST_EVERY_MS));
      next = Math.min(next ?? due, due);
    }
    return next;
  }

  /** Whether the room holds canvas `tabId` in memory, as people write it. */
  holds(tabId: string): boolean {
    return this.sessions.has(tabId);
  }

  /** Saves what canvas `tabId` holds to the Workspace, if it holds anything unsaved. */
  private async keep(tabId: string): Promise<void> {
    const session = this.sessions.get(tabId);
    if (!session || session.saved === session.version) return;
    const version = session.version;
    const body = JSON.stringify(session.doc.toJSON());
    session.unsavedSince = null;
    try {
      // Too long to keep, as only marks on marks make it: what's saved stays, and the room keeps the rest while it can.
      const kept = body.length > MAX_CANVAS_LENGTH || (await this.room.keep(tabId, body, version, session.updatedBy));
      // Deleted as people wrote it: they hear so, and stop.
      if (!kept && !(await this.room.load(tabId))) return this.gone(tabId);
      session.saved = version;
    } catch (error) {
      console.error("Couldn't keep a canvas", error instanceof Error ? error.message : error);
      // The alarm tries again as it next rings.
      session.unsavedSince ??= Date.now();
    }
  }

  /**
   * Saves a canvas sent whole over `save.version`, as a page going away sends one: through what people
   * writing it together have, as one change from what they have, or as it's saved, when nobody is.
   */
  async saveWhole(tabId: string, actor: User, save: CanvasSave): Promise<CanvasAnswer> {
    const session = this.sessions.get(tabId);
    if (!session) return this.room.save(tabId, actor, save);
    if (save.version !== session.version) return { conflict: this.canvasOf(session) };
    const tools = await this.tools();
    const doc = tools.docOf(save.body);
    if (!doc) return { conflict: this.canvasOf(session) };
    const steps = tools.stepsBetween(session.doc, doc);
    if (steps.length > 0) await this.advance(tabId, session, doc, steps, `whole-${actor.id}`, actor);
    await this.keep(tabId);
    return this.sessions.has(tabId) ? { canvas: this.canvasOf(session) } : "not found";
  }

  /** Saves canvas `tabId` and lets it go, once nobody's writing it but `leaving`, which is on its way out. */
  async left(tabId: string, leaving?: WebSocket): Promise<void> {
    if (this.room.writers(tabId).some((ws) => ws !== leaving)) return;
    await this.keep(tabId);
    const session = this.sessions.get(tabId);
    if (session?.saved === session?.version) this.sessions.delete(tabId);
  }

  /** Lets go of canvas `tabId`, which is gone, telling everyone who has it open. */
  gone(tabId: string): void {
    this.sessions.delete(tabId);
    for (const writer of this.room.writers(tabId)) this.room.send(writer, { type: "canvas.refused", tabId, message: CANVAS_GONE });
  }

  /** Forgets every canvas, unsaved, as the room is deleted. */
  forget(): void {
    this.sessions.clear();
  }
}
