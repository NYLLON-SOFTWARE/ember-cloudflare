import type { RoomId } from "@ember/protocol";
import type { RoomTab } from "@ember/protocol/library";
import { roomTabsPath } from "@ember/protocol/library-paths";
import { request } from "./library-request";

// What a room's header asks of its tabs, apart from the rest of the library's requests (library.ts), which load
// with the pages few visits need.

/** A room's tabs, or none where the answer lists none. */
export const fetchTabs = async (roomId: RoomId) => (await request<{ tabs?: RoomTab[] }>(roomTabsPath(roomId))).tabs ?? [];
