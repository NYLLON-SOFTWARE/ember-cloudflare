import type { RoomId } from "@ember/protocol";
import {
  FILE_MARKS_API_PATH,
  FILES_API_PATH,
  roomLibraryPath,
  roomTabPath,
  roomTabsPath,
  type Canvas,
  type FileMark,
  type FileMarks,
  type Library,
  type NewFolderItem,
  type NewTab,
  type OpenedTab,
  type RoomTab,
} from "@ember/protocol/library";
import { ApiError } from "./api";
import { request, sending } from "./library-request";

// The Files page's and room tabs' requests (apps/worker/src/library.ts).

/** Every file and canvas in the rooms you're in. */
export const fetchFiles = () => request<Library>(FILES_API_PATH);

/** A room's files, canvases and links. */
export const fetchRoomLibrary = (roomId: RoomId) => request<Library>(roomLibraryPath(roomId));

/** Stars a file or canvas, or not, or records that it was opened. */
export const markFile = (mark: FileMark) => request<FileMarks>(FILE_MARKS_API_PATH, sending("PUT", mark));

export const addTab = (roomId: RoomId, tab: NewTab) => request<OpenedTab>(roomTabsPath(roomId), sending("POST", tab));

export const openTab = (roomId: RoomId, tabId: string) => request<OpenedTab>(roomTabPath(roomId, tabId));

export const renameTab = (roomId: RoomId, tabId: string, title: string) => request<OpenedTab>(roomTabPath(roomId, tabId), sending("PATCH", { title }));

export const removeTab = (roomId: RoomId, tabId: string) => request<void>(roomTabPath(roomId, tabId), { method: "DELETE" });

export const orderTabs = async (roomId: RoomId, tabIds: string[]) => (await request<{ tabs: RoomTab[] }>(`${roomTabsPath(roomId)}/order`, sending("PUT", { tabIds }))).tabs;

export const addFolderItem = (roomId: RoomId, tabId: string, item: NewFolderItem) => request<OpenedTab>(`${roomTabPath(roomId, tabId)}/items`, sending("POST", item));

export const removeFolderItem = (roomId: RoomId, tabId: string, itemId: string) =>
  request<OpenedTab>(`${roomTabPath(roomId, tabId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });

/** A canvas someone else saved first, which a save over an older version answers with. */
export class CanvasConflict extends Error {
  constructor(readonly canvas: Canvas) {
    super("The canvas changed");
  }
}

/** Saves a canvas over `version`, or fails with a `CanvasConflict` holding the one saved since. */
export async function saveCanvas(roomId: RoomId, tabId: string, body: string, version: number): Promise<OpenedTab> {
  const response = await fetch(`${roomTabPath(roomId, tabId)}/canvas`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, version }) });
  const data = (await response.json().catch(() => ({}))) as OpenedTab & { error?: string; canvas?: Canvas };
  if (response.status === 409 && data.canvas) throw new CanvasConflict(data.canvas);
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`);
  return data;
}

/** The most a request sent as a page goes away may carry, as browsers limit `keepalive` requests to 64 KiB. */
const MAX_KEPTALIVE_BYTES = 60_000;

/**
 * Saves a canvas as the page goes away, in a request that outlives it, unless the canvas is too long to
 * send so, saying whether it sent it. `onAnswer` hears whether it saved, if the page is still there then.
 */
export function saveCanvasOnLeaving(roomId: RoomId, tabId: string, body: string, version: number, onAnswer?: (saved: boolean) => void): boolean {
  const sent = JSON.stringify({ body, version });
  if (new Blob([sent]).size > MAX_KEPTALIVE_BYTES) return false;
  void fetch(`${roomTabPath(roomId, tabId)}/canvas`, { method: "PUT", keepalive: true, headers: { "Content-Type": "application/json" }, body: sent }).then(
    (response) => onAnswer?.(response.ok),
    () => onAnswer?.(false),
  );
  return true;
}

/** A room's address that opens one of its tabs. */
export const roomTabAddress = (roomPath: string, tabId: string) => `${roomPath}?tab=${encodeURIComponent(tabId)}`;
