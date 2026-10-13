import { feature } from "@ember/parity";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { openDb, statement } from "../src/db";
import type { Env } from "../src/env";
import { MIGRATIONS, migrate, type Scope } from "../src/migrations";
import { api, connect, freshRoom, objectSql, post, roomSql, roomStub, workspaceStub } from "./support";

/** The tables each kind of object keeps. A migration's new tables go under the scope it names. */
const TABLES: Record<Scope, string[]> = {
  room: ["boosts", "messages"],
  workspace: ["memberships", "rooms", "sessions", "users"],
};

/** The tables migrations made, leaving out SQLite's, Cloudflare's and the record of migrations. */
const MIGRATED_TABLES = `SELECT name FROM sqlite_master WHERE type = 'table'
  AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name <> 'd1_migrations' ORDER BY name`;

const roomMigrations = MIGRATIONS.filter((migration) => migration.scope === "room");

// The whole worker suite runs twice, once per STORAGE_BACKEND (see vitest.config.ts).
describe(feature("platform.storage"), () => {
  it("keeps messages in the backend STORAGE_BACKEND names", async () => {
    const { storage } = (await (await api("/api/health")).json()) as { storage: string };
    const db = (env as { DB?: D1Database }).DB;
    expect(storage).toBe(db ? "d1" : "do-sqlite");
    if (!db) return;

    const room = await freshRoom("d1");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "stored in D1");
    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    await ada.next("boost.created");

    expect(await db.prepare("SELECT body FROM messages WHERE room_id = ?").bind(room).all()).toMatchObject({ results: [{ body: "stored in D1" }] });
    expect(await db.prepare("SELECT content FROM boosts WHERE room_id = ?").bind(room).all()).toMatchObject({ results: [{ content: "👍" }] });
  });

  it("lists every migration file, oldest first", () => {
    // vitest.config.ts reads TEST_MIGRATIONS from the migrations directory.
    const files = (env as unknown as { TEST_MIGRATIONS: Array<{ name: string }> }).TEST_MIGRATIONS.map((m) => m.name);
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);
  });

  it("gives each kind of object only its own tables, and D1 every kind's", async () => {
    const names = (tables: string[]) => tables.map((name) => ({ name }));
    const db = (env as { DB?: D1Database }).DB;
    if (db) {
      expect((await db.prepare(MIGRATED_TABLES).all()).results).toEqual(names(Object.values(TABLES).flat().sort()));
      return;
    }
    const room = await freshRoom("tables");
    await connect(room, "Ada");
    expect(await objectSql(roomStub(room), MIGRATED_TABLES)).toEqual(names(TABLES.room));
    expect(await objectSql(workspaceStub(), MIGRATED_TABLES)).toEqual(names(TABLES.workspace));
  });

  it("applies each migration once: all of them to D1, and each object's own to its storage", async () => {
    const room = await freshRoom("migrated");
    await connect(room, "Ada");
    const db = (env as { DB?: D1Database }).DB;
    const recorded = (db ? MIGRATIONS : roomMigrations).map(({ name }) => ({ name }));
    expect(await roomSql(room, "SELECT name FROM d1_migrations ORDER BY id")).toEqual(recorded);
    if (!db) {
      await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => migrate(state.storage, "room"));
      expect(await roomSql(room, "SELECT name FROM d1_migrations ORDER BY id")).toEqual(recorded);
      const workspaceMigrations = MIGRATIONS.filter((migration) => migration.scope === "workspace").map(({ name }) => ({ name }));
      expect(await objectSql(workspaceStub(), "SELECT name FROM d1_migrations ORDER BY id")).toEqual(workspaceMigrations);
    }
  });

  it("records the first migration in rooms that ran it before migrations were tracked", async () => {
    if ((env as { DB?: D1Database }).DB) return;
    const room = await freshRoom("untracked");
    const messages = await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => {
      // What every room did on opening before migrate() existed.
      state.storage.sql.exec(MIGRATIONS[0]!.sql);
      state.storage.sql.exec(
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, created_at, updated_at)
         VALUES ('m1', 'untracked', 'c1', 'u1', 'Ada', 'from before', 'now', 'now')`,
      );
      migrate(state.storage, "room");
      return state.storage.sql.exec("SELECT body FROM messages").toArray();
    });
    expect(messages).toEqual([{ body: "from before" }]);
    expect(await roomSql(room, "SELECT name FROM d1_migrations ORDER BY id")).toEqual(roomMigrations.map(({ name }) => ({ name })));
  });

  it("runs a batch as one transaction: if a statement fails, the ones before it are undone", async () => {
    const room = await freshRoom("batch");
    // D1 keeps every room's messages in one table, so the ids are the room's own.
    const insert = (id: string, body: string) =>
      statement(
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, created_at, updated_at)
         VALUES (?, ?, ?, 'u1', 'Ada', ?, 'now', 'now')`,
        `${room}-${id}`,
        room,
        id,
        body,
      );
    const { rows, failure, empty, bodies } = await runInDurableObject(roomStub(room), async (_room, state: DurableObjectState) => {
      const db = openDb(env as unknown as Env, state.storage, "room");
      const rows = await db.batch([insert("m1", "first"), statement("SELECT body FROM messages WHERE room_id = ?", room)]);
      // The second insert reuses m1's id, so the first one mustn't stay behind either.
      const failure = await db.batch([insert("m2", "second"), insert("m1", "again")]).catch((error: unknown) => error);
      return { rows, failure, empty: await db.batch([]), bodies: await db.all("SELECT body FROM messages WHERE room_id = ? ORDER BY id", room) };
    });
    expect(rows).toEqual([[], [{ body: "first" }]]);
    expect(empty).toEqual([]);
    expect(String(failure)).toMatch(/UNIQUE constraint failed: messages\.id/);
    expect(bodies).toEqual([{ body: "first" }]);
  });
});
