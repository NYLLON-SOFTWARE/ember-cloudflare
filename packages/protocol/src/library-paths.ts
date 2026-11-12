import type { RoomId } from "./index.ts";

// The addresses of the library's API, which the app's room tabs ask from its main chunk, imported from
// "@ember/protocol/library-paths" so that chunk doesn't carry the rest of the library (library.ts).

export const FILES_API_PATH = "/api/files";
export const FILE_MARKS_API_PATH = "/api/files/marks";
export const roomLibraryPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/library`;
export const roomTabsPath = (roomId: RoomId) => `/api/rooms/${encodeURIComponent(roomId)}/tabs`;
export const roomTabPath = (roomId: RoomId, tabId: string) => `${roomTabsPath(roomId)}/${encodeURIComponent(tabId)}`;
