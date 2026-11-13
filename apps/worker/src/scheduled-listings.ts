import type { ListedScheduledMessage, RoomId, UserId } from "@ember/protocol";
import { statement, type Db, type Statement } from "./db";

// Everyone's scheduled messages across rooms (migrations/0072_scheduled_listings.sql), as the Workspace
// lists them: a copy of what each room keeps, which the room sends it whenever one changes (see
// `ScheduledMessages.changed` in scheduled.ts).

/** A scheduled message as the Workspace lists it for its author. */
export interface ScheduledListing {
  id: string;
  userId: UserId;
  sendAt: number;
  preview: string;
  parentId?: string;
  failed?: string;
}

/** What a room sends the Workspace of one of its scheduled messages: the message as it is now, or null once it's gone. */
export interface ScheduledChange {
  id: string;
  listing: ScheduledListing | null;
}

/**
 * How many of someone's scheduled messages the list shows, soonest first: a room keeps 50 of theirs, so
 * this many is a person with many rooms full of them.
 */
export const LISTED_SCHEDULED = 1000;

/** Lists a scheduled message, or lists it as it is now, unless its room has been deleted. */
const UPSERT = `INSERT INTO scheduled_listings (room_id, id, user_id, send_at, preview, parent_id, failed, updated_at)
  SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 WHERE EXISTS (SELECT 1 FROM rooms WHERE id = ?1)
  ON CONFLICT (room_id, id) DO UPDATE SET user_id = excluded.user_id, send_at = excluded.send_at, preview = excluded.preview,
    parent_id = excluded.parent_id, failed = excluded.failed, updated_at = excluded.updated_at`;
const DELETE = `DELETE FROM scheduled_listings WHERE room_id = ? AND id = ?`;

/** Person ?1's scheduled messages in the rooms they're still in, soonest first, ?2 at most. */
const LISTED = `SELECT room_id, id, send_at, preview, parent_id, failed FROM scheduled_listings
  WHERE user_id = ?1 AND EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = scheduled_listings.room_id AND memberships.user_id = ?1)
  ORDER BY send_at, id LIMIT ?2`;

interface ListingRow {
  room_id: RoomId;
  id: string;
  send_at: number;
  preview: string;
  parent_id: string | null;
  failed: string | null;
}

const listedOf = (row: ListingRow): ListedScheduledMessage => ({
  id: row.id,
  roomId: row.room_id,
  sendAt: row.send_at,
  preview: row.preview,
  ...(row.parent_id !== null && { parentId: row.parent_id }),
  ...(row.failed !== null && { failed: row.failed }),
});

/** What forgets a deleted room's scheduled messages, in the batch that deletes it. */
export const forgettingScheduledListings = (roomId: RoomId): Statement => statement(`DELETE FROM scheduled_listings WHERE room_id = ?`, roomId);

export class ScheduledListings {
  constructor(private readonly db: Db) {}

  /**
   * Applies what room `roomId` sends of its scheduled messages, in order, in one transaction: each as it is
   * now, or gone. Applying one again changes nothing, so a room can send it as often as it has to.
   */
  async apply(roomId: RoomId, changes: ScheduledChange[], now: string): Promise<void> {
    await this.db.batch(
      changes.map(({ id, listing }) =>
        listing === null
          ? statement(DELETE, roomId, id)
          : statement(UPSERT, roomId, id, listing.userId, listing.sendAt, listing.preview, listing.parentId ?? null, listing.failed ?? null, now),
      ),
    );
  }

  /** `userId`'s scheduled messages in the rooms they're still in, soonest first. */
  async of(userId: UserId): Promise<ListedScheduledMessage[]> {
    return (await this.db.all<ListingRow>(LISTED, userId, LISTED_SCHEDULED)).map(listedOf);
  }
}
