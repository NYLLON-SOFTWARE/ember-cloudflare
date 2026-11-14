// Writes everything a workspace keeps to an NDJSON file, one record to a line, for whoever keeps it:
// everyone first, with their roles, then every room — the shared ones by name and the DMs after them,
// with who's in each that's for just them — each followed by its messages, oldest first, a reply
// naming the thread it's in. DMs are in it whoever they're for, so it answers only to an
// administrator, whom the Worker asks for, and each room's messages it reads a page at a time, as the
// search reindex does:
//
//   pnpm export [Ember's address] [the file to write]
//
// with an administrator's email address in EMBER_EXPORT_EMAIL_ADDRESS and their password in
// EMBER_EXPORT_PASSWORD. The address is http://localhost:5173, where `pnpm dev` serves, and the file
// ember-export.ndjson, unless either is given.

import type { ExportedListing, ExportedMessages, ExportedRoom, ExportedUser, Message } from "@ember/protocol";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ember, type Session } from "./seed/client.ts";
import { workerUrl } from "./worker-url.ts";

/** Where `pnpm dev` serves Ember: Vite, which passes on to `wrangler dev` everything the Worker serves. */
const DEV_URL = "http://localhost:5173";

const DEFAULT_FILE = "ember-export.ndjson";

const USAGE = `Usage: pnpm export [Ember's address] [the file to write], with an administrator's email address in EMBER_EXPORT_EMAIL_ADDRESS and their password in EMBER_EXPORT_PASSWORD`;

/** A problem with how the script was run, which exits with 2 rather than 1. */
class UsageError extends Error {}

/** One line of the export, saying what kind of thing it is and the whole of what Ember keeps of it. */
export type ExportRecord = { type: "user"; user: ExportedUser } | { type: "room"; room: ExportedRoom } | { type: "message"; message: Message };

/** The page of the room's messages after `after`, or the first, oldest first. */
async function messagesPage(ember: Ember, session: Session, roomId: string, after: string | null): Promise<ExportedMessages> {
  const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
  const response = await ember.request(`/api/export/rooms/${encodeURIComponent(roomId)}/messages${query}`, { session });
  return (await response.json()) as ExportedMessages;
}

/** Writes `record` as one line, waiting for the file to take it when it has more than it can hold. */
async function writeRecord(file: WriteStream, record: ExportRecord): Promise<void> {
  if (!file.write(`${JSON.stringify(record)}\n`)) await once(file, "drain");
}

/**
 * Asks the Worker at `ember` for everything, as the administrator `session` signs in, and writes it
 * to `file` a record at a line: everyone, then every room with its messages. It goes first to a
 * private file beside `file` — the export has every DM in it, so only its owner may read it — and
 * takes `file`'s place only once all of it is written, so that a rerun that fails leaves the last
 * export standing. Answers how many of each.
 */
async function writeExportTo(ember: Ember, session: Session, file: string): Promise<{ people: number; rooms: number; messages: number }> {
  const temp = join(dirname(file), `${basename(file)}.${process.pid}.tmp`);
  const stream = createWriteStream(temp, { encoding: "utf8", mode: 0o600 });
  const closed = once(stream, "close").catch(() => {});
  try {
    const listing = (await (await ember.request("/api/export", { session })).json()) as ExportedListing;
    let messages = 0;
    for (const user of listing.users) await writeRecord(stream, { type: "user", user });
    for (const room of listing.rooms) {
      await writeRecord(stream, { type: "room", room });
      // Pages from nothing, then from each page's last message, until the room says there are no more.
      let after: string | null = null;
      for (;;) {
        const page = await messagesPage(ember, session, room.id, after);
        for (const message of page.messages) await writeRecord(stream, { type: "message", message });
        messages += page.messages.length;
        if (!page.hasMore) break;
        after = page.messages.at(-1)!.id;
      }
    }
    stream.end();
    await once(stream, "finish");
    await closed;
    await rename(temp, file);
    return { people: listing.users.length, rooms: listing.rooms.length, messages };
  } catch (error) {
    stream.destroy();
    await closed;
    await unlink(temp).catch(() => {});
    throw error;
  }
}

async function main(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  if (args.length > 2) throw new UsageError(USAGE);
  const url = workerUrl(args[0] ?? DEV_URL);
  if (!url) throw new UsageError(`${USAGE}. The address has to be HTTPS, or HTTP on this machine.`);
  const [emailAddress, password] = [env.EMBER_EXPORT_EMAIL_ADDRESS?.trim(), env.EMBER_EXPORT_PASSWORD];
  if (!emailAddress || !password)
    throw new UsageError(`${USAGE}, with the administrator's email address in EMBER_EXPORT_EMAIL_ADDRESS and their password in EMBER_EXPORT_PASSWORD`);
  const ember = new Ember(url.origin);
  const administrator = await ember.signIn(emailAddress, password);
  // Before anything is asked, so whoever isn't one hears so from the script, whatever it asks for.
  if (!administrator.user.administrator)
    throw new UsageError(`${administrator.user.name} isn't one of ${ember.origin}'s administrators, and Ember exports for them alone`);
  const file = args[1] ?? DEFAULT_FILE;
  console.log(`Exporting ${ember.origin} as ${administrator.user.name} to ${file}.`);
  const written = await writeExportTo(ember, administrator, file);
  return `Wrote ${written.people} people, ${written.rooms} rooms and ${written.messages} messages to ${file}.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(await main(process.argv.slice(2), process.env));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
