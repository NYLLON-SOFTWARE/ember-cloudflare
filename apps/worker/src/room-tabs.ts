import {
  EMPTY_CANVAS,
  MAX_FOLDER_ITEMS,
  MAX_ROOM_TABS,
  type Canvas,
  type CanvasSave,
  type FileMark,
  type FileMarks,
  type RoomTabKind,
  type TabChange,
} from "@ember/protocol/library";
import type { RoomId, User, UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "./db";
import type { AttachedFile } from "./files/blobs";
import { sortableId } from "./ids";

// Room tabs, folders and canvases (migrations/0061_room_tabs.sql), and what each person has starred and
// opened of the files they can see (migrations/0060_file_marks.sql), kept by the Workspace, which knows who's
// in each room. A file a tab or folder holds is kept without its addresses, which the Worker signs as it
// answers (library.ts).

/** A file sent in a room, as a tab or folder keeps it: its message, and the file without its addresses. */
export interface KeptFile {
  messageId: string;
  file: AttachedFile;
}

/** What a new tab or folder item holds, once the Worker has found a file's message in the room. */
export type KeptTarget = { kind: "file"; kept: KeptFile } | { kind: "link"; url: string } | { kind: "folder" } | { kind: "canvas" };

/** A room's tab as the Workspace answers it, its file not yet signed. */
export interface KeptTab {
  id: string;
  roomId: RoomId;
  kind: RoomTabKind;
  title: string;
  creator: User;
  createdAt: string;
  updatedAt: string;
  kept?: KeptFile;
  url?: string;
}

/** A folder's file or link as the Workspace answers it. */
export interface KeptItem {
  id: string;
  title: string;
  creator: User;
  createdAt: string;
  kept?: KeptFile;
  url?: string;
}

/** A canvas the Files page lists, in one of the reader's rooms. */
export interface CanvasEntry {
  id: string;
  roomId: RoomId;
  title: string;
  creator: User;
  createdAt: string;
  updatedAt: string;
}

/** Someone's mark on a file. */
export interface FileMarkRow {
  fileId: string;
  starred: boolean;
  viewedAt: string | null;
}

/** What the Workspace gives the Worker to list someone's files by: the rooms they can see, the canvases there and their marks. */
export interface LibraryShelf {
  userId: UserId;
  roomIds: RoomId[];
  canvases: CanvasEntry[];
  marks: FileMarkRow[];
}

/** What someone asks of a room's tabs, once the Worker has checked what they sent. */
export type TabAction =
  | { act: "list" }
  | { act: "add"; title: string; target: KeptTarget }
  | { act: "change"; tabId: string; change: TabChange }
  | { act: "remove"; tabId: string }
  | { act: "order"; tabIds: string[] }
  | { act: "open"; tabId: string }
  | { act: "save"; tabId: string; save: CanvasSave }
  | { act: "add-item"; tabId: string; title: string; target: KeptTarget }
  | { act: "remove-item"; tabId: string; itemId: string };

/** What a tab action answers, or why it's refused. */
export type TabAnswer =
  | { tabs: KeptTab[] }
  | { tab: KeptTab; items?: KeptItem[]; canvas?: Canvas }
  | { removed: true }
  | { conflict: Canvas }
  | "not found"
  | "forbidden"
  | "full";

interface TabRow {
  id: string;
  room_id: RoomId;
  kind: RoomTabKind;
  title: string;
  target: string | null;
  creator_id: UserId;
  creator_name: string;
  created_at: string;
  updated_at: string;
}

interface CanvasRow {
  body: string | null;
  version: number;
  updated_at: string;
  updater_id: UserId;
  updater_name: string;
}

interface ItemRow {
  id: string;
  title: string;
  target: string;
  creator_id: UserId;
  creator_name: string;
  created_at: string;
}

const TAB_COLUMNS = `id, room_id, kind, title, target, creator_id, creator_name, created_at, updated_at`;

const ROOM_TABS = `SELECT ${TAB_COLUMNS} FROM room_tabs WHERE room_id = ? ORDER BY position, id`;

const ROOM_TAB = `SELECT ${TAB_COLUMNS} FROM room_tabs WHERE room_id = ? AND id = ?`;

const CANVAS = `SELECT body, version, updated_at, updater_id, updater_name FROM room_tabs WHERE room_id = ? AND id = ? AND kind = 'canvas'`;

/**
 * Adds a tab after the room's others, unless it has `MAX_ROOM_TABS` already, answering its id if it was added:
 * one statement, so two added at once can't pass the limit together.
 */
const ADD_TAB = `INSERT INTO room_tabs (id, room_id, kind, title, position, target, body, creator_id, creator_name, updater_id, updater_name, created_at, updated_at)
  SELECT ?1, ?2, ?3, ?4, COALESCE((SELECT max(position) FROM room_tabs WHERE room_id = ?2), 0) + 1, ?5, ?6, ?7, ?8, ?7, ?8, ?9, ?9
  WHERE (SELECT count(*) FROM room_tabs WHERE room_id = ?2) < ${MAX_ROOM_TABS}
  RETURNING id`;

const RENAME_TAB = `UPDATE room_tabs SET title = ?, updated_at = ? WHERE room_id = ? AND id = ? RETURNING id`;

/** Puts the room's tabs a JSON array ?2 names in its order. */
const ORDER_TABS = `UPDATE room_tabs SET position = 1 + (SELECT key FROM json_each(?2) AS listed WHERE listed.value = room_tabs.id)
  WHERE room_id = ?1 AND id IN (SELECT value FROM json_each(?2))`;

/** Saves a canvas over the version it was changed from, answering its new version, or nothing once someone else has saved it since. */
const SAVE_CANVAS = `UPDATE room_tabs SET body = ?1, version = version + 1, updater_id = ?2, updater_name = ?3, updated_at = ?4
  WHERE room_id = ?5 AND id = ?6 AND kind = 'canvas' AND version = ?7
  RETURNING body, version, updated_at, updater_id, updater_name`;

/**
 * Keeps what people writing a canvas together left it at, as the room's object has it, at its version:
 * one past the version of each change they made, so it only ever goes over an older one.
 */
const KEEP_CANVAS = `UPDATE room_tabs SET body = ?1, version = ?2, updater_id = ?3, updater_name = ?4, updated_at = ?5
  WHERE room_id = ?6 AND id = ?7 AND kind = 'canvas' AND version < ?2
  RETURNING id`;

const FOLDER_ITEMS = `SELECT id, title, target, creator_id, creator_name, created_at FROM room_tab_items WHERE tab_id = ? ORDER BY created_at, id`;

/** Adds a file or link to a folder of the room's, unless it holds `MAX_FOLDER_ITEMS` already. */
const ADD_ITEM = `INSERT INTO room_tab_items (id, room_id, tab_id, title, target, creator_id, creator_name, created_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
  WHERE EXISTS (SELECT 1 FROM room_tabs WHERE room_id = ?2 AND id = ?3 AND kind = 'folder')
    AND (SELECT count(*) FROM room_tab_items WHERE tab_id = ?3) < ${MAX_FOLDER_ITEMS}
  RETURNING id`;

/** The canvases in the rooms a JSON array names. */
const CANVASES_IN = `SELECT id, room_id, title, creator_id, creator_name, created_at, updated_at FROM room_tabs
  WHERE kind = 'canvas' AND room_id IN (SELECT value FROM json_each(?))`;

const MARKS_OF = `SELECT file_id, starred_at, viewed_at FROM file_marks WHERE user_id = ?`;

const STAR = `INSERT INTO file_marks (user_id, file_id, room_id, starred_at) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (user_id, file_id) DO UPDATE SET starred_at = ?4
  RETURNING starred_at, viewed_at`;

const VIEW = `INSERT INTO file_marks (user_id, file_id, room_id, viewed_at) VALUES (?1, ?2, ?3, ?4)
  ON CONFLICT (user_id, file_id) DO UPDATE SET viewed_at = ?4
  RETURNING starred_at, viewed_at`;

const user = (id: UserId, name: string): User => ({ id, name });

function targetOf(target: string | null): Pick<KeptTab, "kept" | "url"> {
  if (target === null) return {};
  const parsed = JSON.parse(target) as { url?: string } & Partial<KeptFile>;
  if (parsed.url !== undefined) return { url: parsed.url };
  return parsed.file && parsed.messageId ? { kept: { messageId: parsed.messageId, file: parsed.file } } : {};
}

const tabOf = (row: TabRow): KeptTab => ({
  id: row.id,
  roomId: row.room_id,
  kind: row.kind,
  title: row.title,
  creator: user(row.creator_id, row.creator_name),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...targetOf(row.target),
});

const itemOf = (row: ItemRow): KeptItem => ({
  id: row.id,
  title: row.title,
  creator: user(row.creator_id, row.creator_name),
  createdAt: row.created_at,
  ...targetOf(row.target),
});

const canvasOf = (row: CanvasRow): Canvas => ({
  body: row.body ?? EMPTY_CANVAS,
  version: row.version,
  updatedAt: row.updated_at,
  updatedBy: user(row.updater_id, row.updater_name),
});

/** A target as a tab or item keeps it. */
function storedTarget(target: KeptTarget): string | null {
  if (target.kind === "file") return JSON.stringify(target.kept);
  if (target.kind === "link") return JSON.stringify({ url: target.url });
  return null;
}

/** What forgets a deleted room's tabs, folders and the marks on its files, in the batch that deletes it. */
export function forgettingRoomTabs(roomId: RoomId): Statement[] {
  return [
    statement(`DELETE FROM room_tab_items WHERE room_id = ?`, roomId),
    statement(`DELETE FROM room_tabs WHERE room_id = ?`, roomId),
    statement(`DELETE FROM file_marks WHERE room_id = ?`, roomId),
  ];
}

/** A room's tabs, folders and canvases, and the marks people put on files. */
export class RoomTabStore {
  constructor(private readonly db: Db) {}

  /**
   * Does what `action` asks of room `roomId`'s tabs for `actor`, a member of the room, at `now`. Someone
   * whose IP address is banned can read the tabs but not change them.
   */
  async act(roomId: RoomId, actor: User, banned: boolean, action: TabAction, now: string): Promise<TabAnswer> {
    if (action.act === "list") return { tabs: await this.tabs(roomId) };
    if (action.act === "open") return this.open(roomId, action.tabId);
    if (banned) return "forbidden";
    switch (action.act) {
      case "add":
        return this.add(roomId, actor, action.title, action.target, now);
      case "change": {
        const [renamed] = await this.db.all<{ id: string }>(RENAME_TAB, action.change.title, now, roomId, action.tabId);
        return renamed ? this.open(roomId, action.tabId) : "not found";
      }
      case "remove":
        return this.remove(roomId, action.tabId);
      case "order":
        await this.db.run(ORDER_TABS, roomId, JSON.stringify(action.tabIds));
        return { tabs: await this.tabs(roomId) };
      case "save":
        return this.save(roomId, actor, action.tabId, action.save, now);
      case "add-item":
        return this.addItem(roomId, actor, action.tabId, action.title, action.target, now);
      case "remove-item":
        await this.db.run(`DELETE FROM room_tab_items WHERE room_id = ? AND tab_id = ? AND id = ?`, roomId, action.tabId, action.itemId);
        return this.open(roomId, action.tabId);
    }
  }

  async tabs(roomId: RoomId): Promise<KeptTab[]> {
    return (await this.db.all<TabRow>(ROOM_TABS, roomId)).map(tabOf);
  }

  private async open(roomId: RoomId, tabId: string): Promise<TabAnswer> {
    const [row] = await this.db.all<TabRow>(ROOM_TAB, roomId, tabId);
    if (!row) return "not found";
    const tab = tabOf(row);
    if (tab.kind === "folder") return { tab, items: (await this.db.all<ItemRow>(FOLDER_ITEMS, tabId)).map(itemOf) };
    if (tab.kind !== "canvas") return { tab };
    const [canvas] = await this.db.all<CanvasRow>(CANVAS, roomId, tabId);
    return { tab, canvas: canvasOf(canvas!) };
  }

  private async add(roomId: RoomId, actor: User, title: string, target: KeptTarget, now: string): Promise<TabAnswer> {
    const id = sortableId();
    const body = target.kind === "canvas" ? EMPTY_CANVAS : null;
    const [added] = await this.db.all<{ id: string }>(ADD_TAB, id, roomId, target.kind, title, storedTarget(target), body, actor.id, actor.name, now);
    return added ? this.open(roomId, id) : "full";
  }

  private async remove(roomId: RoomId, tabId: string): Promise<TabAnswer> {
    const [, removed] = await this.db.batch([
      statement(`DELETE FROM room_tab_items WHERE room_id = ? AND tab_id = ?`, roomId, tabId),
      statement(`DELETE FROM room_tabs WHERE room_id = ? AND id = ? RETURNING id`, roomId, tabId),
      statement(`DELETE FROM file_marks WHERE room_id = ? AND file_id = ?`, roomId, tabId),
    ]);
    return removed!.length > 0 ? { removed: true } : "not found";
  }

  private async save(roomId: RoomId, actor: User, tabId: string, { body, version }: CanvasSave, now: string): Promise<TabAnswer> {
    const [saved] = await this.db.all<CanvasRow>(SAVE_CANVAS, body, actor.id, actor.name, now, roomId, tabId, version);
    if (saved) {
      const [row] = await this.db.all<TabRow>(ROOM_TAB, roomId, tabId);
      return { tab: tabOf(row!), canvas: canvasOf(saved) };
    }
    const [current] = await this.db.all<CanvasRow>(CANVAS, roomId, tabId);
    return current ? { conflict: canvasOf(current) } : "not found";
  }

  private async addItem(roomId: RoomId, actor: User, tabId: string, title: string, target: KeptTarget, now: string): Promise<TabAnswer> {
    if (target.kind !== "file" && target.kind !== "link") return "not found";
    const [added] = await this.db.all<{ id: string }>(ADD_ITEM, sortableId(), roomId, tabId, title, storedTarget(target), actor.id, actor.name, now);
    if (added) return this.open(roomId, tabId);
    const [folder] = await this.db.all<TabRow>(ROOM_TAB, roomId, tabId);
    return folder?.kind === "folder" ? "full" : "not found";
  }

  /** The canvases in `roomIds`, for the Files page. */
  async canvasesIn(roomIds: RoomId[]): Promise<CanvasEntry[]> {
    const rows = await this.db.all<Omit<TabRow, "kind" | "target">>(CANVASES_IN, JSON.stringify(roomIds));
    return rows.map((row) => ({
      id: row.id,
      roomId: row.room_id,
      title: row.title,
      creator: user(row.creator_id, row.creator_name),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** What `userId` has starred and opened. */
  async marksOf(userId: UserId): Promise<FileMarkRow[]> {
    const rows = await this.db.all<{ file_id: string; starred_at: string | null; viewed_at: string | null }>(MARKS_OF, userId);
    return rows.map((row) => ({ fileId: row.file_id, starred: row.starred_at !== null, viewedAt: row.viewed_at }));
  }

  /** Room `roomId`'s canvas `tabId` as it's saved, or null where the room has no such canvas. */
  async canvas(roomId: RoomId, tabId: string): Promise<Canvas | null> {
    const [row] = await this.db.all<CanvasRow>(CANVAS, roomId, tabId);
    return row ? canvasOf(row) : null;
  }

  /** Keeps `body` as canvas `tabId` at `version`, by `by`, unless it's saved at that version or a later one already. */
  async keepCanvas(roomId: RoomId, tabId: string, body: string, version: number, by: User, now: string): Promise<boolean> {
    return (await this.db.all(KEEP_CANVAS, body, version, by.id, by.name, now, roomId, tabId)).length > 0;
  }

  /** Whether room `roomId` has a canvas tab `tabId`. */
  async hasCanvas(roomId: RoomId, tabId: string): Promise<boolean> {
    return (await this.db.all(CANVAS, roomId, tabId)).length > 0;
  }

  /** Stars or unstars a file for `userId`, or records that they opened it, answering its marks. */
  async mark(userId: UserId, { fileId, roomId, starred, viewed }: FileMark, now: string): Promise<FileMarks> {
    const statements = [
      ...(starred !== undefined ? [statement(STAR, userId, fileId, roomId, starred ? now : null)] : []),
      ...(viewed ? [statement(VIEW, userId, fileId, roomId, now)] : []),
    ];
    const results = (await this.db.batch(statements)) as Array<Array<{ starred_at: string | null; viewed_at: string | null }>>;
    const row = results.at(-1)![0]!;
    return { starred: row.starred_at !== null, viewedAt: row.viewed_at };
  }
}
