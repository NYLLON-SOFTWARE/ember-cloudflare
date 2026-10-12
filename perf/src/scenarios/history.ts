import { HISTORY_PAGE_SIZE } from "@ember/protocol";
import { closeAll, joinMany, roomName, seedRoom } from "../load.ts";
import { RoomClient } from "../room-client.ts";
import type { Server } from "../server.ts";
import { summarize, type Summary } from "../stats.ts";

export interface HistoryOptions {
  messages: number;
  /** Every nth message gets two reactions, so pages read boosts too. */
  boostEvery: number;
  /** Fresh connections to time. Each one reads the newest page for its welcome. */
  welcomes: number;
  /** Times to page from the newest message back to the first. */
  passes: number;
}

export interface HistoryResult extends HistoryOptions {
  /** Opening a socket to its welcome frame, which carries the newest page. */
  welcome: Summary | null;
  /** A history.before request to its page of 50. */
  page: Summary | null;
}

/** A room with a long backlog: how fast it hands out pages, which is where the two storage backends differ most. */
export async function history(server: Server, options: HistoryOptions): Promise<HistoryResult> {
  const room = roomName("history");
  const {
    clients: [writer],
  } = await joinMany(server, room, 1, { name: "writer" });
  await seedRoom([writer!], options.messages, options.boostEvery);

  const welcomeMs: number[] = [];
  let oldestShown = "";
  for (let i = 0; i < options.welcomes; i++) {
    const { client, welcome, ms } = await RoomClient.connect(server.url, room, writer!.session);
    welcomeMs.push(ms);
    oldestShown = welcome.messages[0]!.id;
    client.close();
  }

  const pageMs: number[] = [];
  for (let pass = 0; pass < options.passes; pass++) {
    for (let before = oldestShown, hasMore = true; hasMore; ) {
      const page = await writer!.history(before, HISTORY_PAGE_SIZE);
      pageMs.push(page.ms);
      hasMore = page.hasMore;
      before = page.messages[0]?.id ?? before;
    }
  }
  closeAll([writer!]);

  return { ...options, welcome: summarize(welcomeMs), page: summarize(pageMs) };
}
