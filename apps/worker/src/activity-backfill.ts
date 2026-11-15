import { mentionsEveryone, previewOf, type ActivityKind, type RoomId, type UserId } from "@ember/protocol";
import { ACTIVE, BOT } from "./activity";
import { statement, type Db, type Statement } from "./db";
import { followersOf, mentionedIds, type StoredMentions } from "./room-log";

// Activity began empty when it shipped (migrations/0065_activity.sql): the Workspace records its items as
// rooms' messages and reactions come, so everything before then was missing. This fills in what the last
// `BACKFILL_DAYS` would have recorded, once: each room answers its recent messages and reactions, and the
// Workspace records them for whoever is in the room now, as `RECORD_MESSAGE` and `RECORD_REACTION` would
// have, already read, up to `BACKFILL_PER_PERSON` items each. Items are numbered below every other, so they
// come after those recorded since, newest first, and nothing is recorded twice, so it can run again.

export const BACKFILL_DAYS = 30;
export const BACKFILL_PER_PERSON = 500;
/** The most messages, and the most reactions, a room answers with, its newest. */
export const BACKFILL_PER_ROOM = 2000;
/** How many items one statement inserts, as one JSON list, which binds one value however long it is. */
const ITEMS_AT_ONCE = 100;

/** A message in a room's history, with what its item would say and whom it would be for. */
export interface HistoryMessage {
  id: string;
  authorId: UserId;
  preview: string;
  mentionIds: UserId[];
  everyone: boolean;
  /** For a reply in a thread, what it replies to, and who followed the thread by then. */
  parentId: string | null;
  followerIds: UserId[];
  /** Whether it's in the room's timeline, as all but a reply in a thread not also sent to it are. */
  inRoom: boolean;
  at: string;
}

/** A reaction to a message in a room's history. */
export interface HistoryReaction {
  messageId: string;
  /** The thread the message is a reply in, if it is. */
  parentId: string | null;
  /** Who wrote the message, whose item it would be. */
  authorId: UserId;
  reactorId: UserId;
  content: string;
  preview: string;
  at: string;
}

export interface RoomHistory {
  messages: HistoryMessage[];
  reactions: HistoryReaction[];
}

/**
 * Room ?1's messages since ?2 but deleted ones, and those whose event the Workspace has yet to apply, which
 * records them as it does, newest first, up to ?3, each reply with its thread as it was when it came: what
 * it replies to and the replies before it, `[creator, mentions]` each.
 */
const HISTORY_MESSAGES = `SELECT messages.id, messages.creator_id AS authorId, messages.plain_text AS plainText, messages.mentions,
    messages.parent_id AS parentId, messages.in_room AS inRoom, messages.created_at AS at,
    CASE WHEN messages.parent_id IS NULL THEN NULL ELSE (
      SELECT json_group_array(json_array(thread.creator_id, json(coalesce(thread.mentions, '[]')))) FROM messages AS thread
        WHERE thread.room_id = ?1 AND (thread.id = messages.parent_id OR (thread.parent_id = messages.parent_id AND thread.created_at < messages.created_at))
    ) END AS thread
  FROM messages WHERE messages.room_id = ?1 AND messages.deleted = 0 AND messages.created_at >= ?2
    AND NOT EXISTS (SELECT 1 FROM room_events WHERE room_events.room_id = ?1 AND room_events.message_id = messages.id)
  ORDER BY messages.id DESC LIMIT ?3`;

/** Room ?1's reactions since ?2 to messages not deleted, newest first, up to ?3. */
const HISTORY_REACTIONS = `SELECT boosts.message_id AS messageId, messages.parent_id AS parentId, messages.creator_id AS authorId, boosts.booster_id AS reactorId,
    boosts.content, messages.plain_text AS plainText, boosts.created_at AS at
  FROM boosts JOIN messages ON messages.id = boosts.message_id AND messages.deleted = 0
  WHERE boosts.room_id = ?1 AND boosts.created_at >= ?2
  ORDER BY boosts.created_at DESC LIMIT ?3`;

interface HistoryMessageRow {
  id: string;
  authorId: UserId;
  plainText: string | null;
  mentions: string | null;
  parentId: string | null;
  inRoom: number;
  at: string;
  thread: string | null;
}

/** Room `roomId`'s messages and reactions since `since`, as the room answers the Workspace. */
export async function roomHistory(db: Db, roomId: RoomId, since: string): Promise<RoomHistory> {
  const [messages, reactions] = (await db.batch([
    statement(HISTORY_MESSAGES, roomId, since, BACKFILL_PER_ROOM),
    statement(HISTORY_REACTIONS, roomId, since, BACKFILL_PER_ROOM),
  ])) as [HistoryMessageRow[], Array<Omit<HistoryReaction, "preview"> & { plainText: string | null }>];
  return {
    messages: messages.map(({ plainText, mentions, thread, inRoom, ...message }) => ({
      ...message,
      preview: previewOf(plainText ?? ""),
      mentionIds: [...new Set(mentionedIds(JSON.parse(mentions ?? "[]") as StoredMentions))],
      everyone: mentionsEveryone(plainText ?? ""),
      followerIds: thread === null ? [] : followersOf(thread),
      inRoom: inRoom === 1,
    })),
    reactions: reactions.map(({ plainText, ...reaction }) => ({ ...reaction, preview: previewOf(plainText ?? "") })),
  };
}

/** Who room ?1's items would be for now: its active members but bots, with how much they hear of it. */
const RECIPIENTS = `SELECT memberships.user_id AS userId, memberships.involvement, rooms.kind FROM rooms
    JOIN memberships ON memberships.room_id = rooms.id
    JOIN users ON users.id = memberships.user_id
  WHERE rooms.id = ?1 AND users.status = ${ACTIVE} AND users.role <> ${BOT}`;

interface Recipient {
  userId: UserId;
  involvement: string;
  kind: string;
}

export const recipientsOf = (db: Db, roomId: RoomId) => db.all<Recipient>(RECIPIENTS, roomId);

/** An item the backfill would record. */
export interface BackfillItem {
  userId: UserId;
  kind: ActivityKind;
  roomId: RoomId;
  messageId: string;
  parentId: string | null;
  actorId: UserId;
  preview: string;
  content: string | null;
  at: string;
}

/** The items room `roomId`'s `history` would have recorded for `recipients`, by the rules recording them as they come follows. */
export function itemsOf(roomId: RoomId, recipients: Recipient[], { messages, reactions }: RoomHistory): BackfillItem[] {
  const items: BackfillItem[] = [];
  for (const message of messages) {
    for (const { userId, involvement, kind: roomKind } of recipients) {
      if (userId === message.authorId) continue;
      const mentioned = message.everyone || message.mentionIds.includes(userId);
      const following = message.parentId !== null && message.followerIds.includes(userId);
      const hears = involvement !== "nothing" && involvement !== "invisible";
      if (!mentioned && !(hears && (following || (roomKind === "direct" && message.inRoom)))) continue;
      const kind: ActivityKind = mentioned ? "mention" : following ? "thread" : "direct";
      items.push({ userId, kind, roomId, messageId: message.id, parentId: message.parentId, actorId: message.authorId, preview: message.preview, content: null, at: message.at });
    }
  }
  const members = new Set(recipients.map((recipient) => recipient.userId));
  for (const reaction of reactions) {
    if (reaction.authorId === reaction.reactorId || !members.has(reaction.authorId)) continue;
    items.push({ userId: reaction.authorId, kind: "reaction", roomId, messageId: reaction.messageId, parentId: reaction.parentId, actorId: reaction.reactorId, preview: reaction.preview, content: reaction.content, at: reaction.at });
  }
  return items;
}

const oldestFirst = (a: BackfillItem, b: BackfillItem) => a.at.localeCompare(b.at) || a.messageId.localeCompare(b.messageId);

/** `theirs`, one person's items, but their newest `BACKFILL_PER_PERSON`, oldest first. */
const newestOf = (theirs: BackfillItem[]) => theirs.sort(oldestFirst).slice(-BACKFILL_PER_PERSON);

/**
 * The items the backfill collects from room after room, keeping each person's newest `BACKFILL_PER_PERSON`
 * as they come, so that a room with many people and @everyone messages holds no more than that each.
 */
export class BackfillItems {
  private readonly byPerson = new Map<UserId, BackfillItem[]>();

  add(items: Iterable<BackfillItem>): void {
    for (const item of items) {
      let theirs = this.byPerson.get(item.userId);
      if (!theirs) this.byPerson.set(item.userId, (theirs = []));
      theirs.push(item);
      if (theirs.length > 2 * BACKFILL_PER_PERSON) this.byPerson.set(item.userId, newestOf(theirs));
    }
  }

  /** Each person's newest items, everyone's oldest first. */
  newest(): BackfillItem[] {
    return [...this.byPerson.values()].flatMap(newestOf).sort(oldestFirst);
  }
}

/** The lowest item number so far, or 0 with none below it. */
const LOWEST_ID = `SELECT min(coalesce(min(id), 0), 0) AS lowest FROM activity`;

/** A field of the JSON item `json_each` reads. */
const field = (name: string) => `json_extract(item.value, '$.${name}')`;

/**
 * Records the items a JSON list ?1 holds, each with its own number, read as of ?2, but those of anyone no
 * longer in its room, and those recorded already: an item about the same message for the same person, or
 * for a reaction, the same reaction.
 */
const RECORD_BACKFILL = `INSERT INTO activity (id, user_id, kind, room_id, message_id, parent_id, actor_id, preview, content, created_at, read_at)
  SELECT ${field("id")}, ${field("userId")}, ${field("kind")}, ${field("roomId")}, ${field("messageId")}, ${field("parentId")}, ${field("actorId")},
    ${field("preview")}, ${field("content")}, ${field("at")}, ?2
  FROM json_each(?1) AS item
  WHERE EXISTS (SELECT 1 FROM memberships WHERE memberships.room_id = ${field("roomId")} AND memberships.user_id = ${field("userId")})
    AND NOT EXISTS (SELECT 1 FROM activity WHERE activity.message_id = ${field("messageId")} AND activity.user_id = ${field("userId")}
      AND CASE WHEN ${field("kind")} = 'reaction'
        THEN activity.kind = 'reaction' AND activity.actor_id = ${field("actorId")} AND activity.content = ${field("content")}
        ELSE activity.kind <> 'reaction' END)
  RETURNING id`;

/**
 * Records `items`, oldest first, already read as of `readAt`, numbered below every item so far, -1 at most,
 * so that the feed, newest number first, shows them after those recorded as they came. Answers how many
 * it recorded.
 */
export async function recordBackfill(db: Db, items: BackfillItem[], readAt: string): Promise<number> {
  if (items.length === 0) return 0;
  const [{ lowest }] = (await db.all<{ lowest: number }>(LOWEST_ID)) as [{ lowest: number }];
  const numbered = items.map((item, index) => ({ ...item, id: lowest - items.length + index }));
  const statements: Statement[] = [];
  for (let start = 0; start < numbered.length; start += ITEMS_AT_ONCE) {
    statements.push(statement(RECORD_BACKFILL, JSON.stringify(numbered.slice(start, start + ITEMS_AT_ONCE)), readAt));
  }
  return ((await db.batch(statements)) as unknown[][]).reduce((count, rows) => count + rows.length, 0);
}

// Reactions were recorded without the thread of the reply they were to, so the Workspace puts them in
// theirs once, asking each room which of the messages they were to are replies.

/** Room ?1's messages of the JSON list ?2 that are replies, with the thread each is in. */
const THREADS_OF = `SELECT id, parent_id AS parentId FROM messages
  WHERE room_id = ?1 AND parent_id IS NOT NULL AND id IN (SELECT value FROM json_each(?2))`;

/** A reply and the thread it's in. */
export interface ReplyThread {
  id: string;
  parentId: string;
}

/** Which of room `roomId`'s messages `messageIds` are replies, and in which thread, as the room answers the Workspace. */
export const threadsOf = (db: Db, roomId: RoomId, messageIds: string[]) => db.all<ReplyThread>(THREADS_OF, roomId, JSON.stringify(messageIds));

/** Each room with reaction items in no thread, and the messages they're about. */
const UNTHREADED_REACTIONS = `SELECT room_id AS roomId, json_group_array(DISTINCT message_id) AS messageIds FROM activity
  WHERE kind = 'reaction' AND parent_id IS NULL GROUP BY room_id`;

export async function unthreadedReactions(db: Db): Promise<Array<{ roomId: RoomId; messageIds: string[] }>> {
  const rows = await db.all<{ roomId: RoomId; messageIds: string }>(UNTHREADED_REACTIONS);
  return rows.map(({ roomId, messageIds }) => ({ roomId, messageIds: JSON.parse(messageIds) as string[] }));
}

/** Puts the reaction items about each reply of the JSON list ?1 in the reply's thread. */
const THREAD_REACTIONS = `UPDATE activity
  SET parent_id = (SELECT ${field("parentId")} FROM json_each(?1) AS item WHERE ${field("id")} = activity.message_id)
  WHERE kind = 'reaction' AND parent_id IS NULL AND message_id IN (SELECT ${field("id")} FROM json_each(?1) AS item)`;

/** Puts the reaction items about `replies` in their threads. */
export async function threadReactions(db: Db, replies: ReplyThread[]): Promise<void> {
  for (let start = 0; start < replies.length; start += ITEMS_AT_ONCE) await db.run(THREAD_REACTIONS, JSON.stringify(replies.slice(start, start + ITEMS_AT_ONCE)));
}
