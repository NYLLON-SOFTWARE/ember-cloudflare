import { feature } from "@ember/parity";
import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { MIGRATIONS, migrate } from "../src/migrations";
import { api, connect, freshRoom, post, roomSql, roomStub } from "./support";

// The whole worker suite runs twice, once per STORAGE_BACKEND (see vitest.config.ts).
describe(feature("platform.storage"), () => {
  it("keeps messages in the backend STORAGE_BACKEND names", async () => {
    const { storage } = (await (await api("/api/health")).json()) as { storage: string };
    const db = (env as { DB?: D1Database }).DB;
    expect(storage).toBe(db ? "d1" : "do-sqlite");
    if (!db) return;

    const room = freshRoom("d1");
    const ada = await connect(room, "Ada");
    const message = await post(ada, "stored in D1");
    ada.send({ type: "boost.create", messageId: message.id, content: "👍" });
    await ada.next("boost.created");

    expect(await db.prepare("SELECT body FROM messages WHERE room_id = ?").bind(room).all()).toMatchObject({ results: [{ body: "stored in D1" }] });
    expect(await db.prepare("SELECT content FROM boosts WHERE room_id = ?").bind(room).all()).toMatchObject({ results: [{ content: "👍" }] });
  });

  it("applies every migration file to a room's storage, once", async () => {
    // vitest.config.ts reads TEST_MIGRATIONS from the migrations directory.
    const files = (env as unknown as { TEST_MIGRATIONS: Array<{ name: string }> }).TEST_MIGRATIONS.map((m) => m.name);
    expect(MIGRATIONS.map((m) => m.name)).toEqual(files);

    const room = freshRoom("migrated");
    await connect(room, "Ada");
    const recorded = files.map((name) => ({ name }));
    expect(await roomSql(room, "SELECT name FROM d1_migrations ORDER BY id")).toEqual(recorded);
    if (!(env as { DB?: D1Database }).DB) {
      await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => migrate(state.storage));
      expect(await roomSql(room, "SELECT name FROM d1_migrations ORDER BY id")).toEqual(recorded);
    }
  });

  it("records the first migration in rooms that ran it before migrations were tracked", async () => {
    if ((env as { DB?: D1Database }).DB) return;
    const room = freshRoom("untracked");
    const messages = await runInDurableObject(roomStub(room), (_room, state: DurableObjectState) => {
      // What every room did on opening before migrate() existed.
      state.storage.sql.exec(MIGRATIONS[0]!.sql);
      state.storage.sql.exec(
        `INSERT INTO messages (id, room_id, client_message_id, creator_id, creator_name, body, created_at, updated_at)
         VALUES ('m1', 'untracked', 'c1', 'u1', 'Ada', 'from before', 'now', 'now')`,
      );
      migrate(state.storage);
      return state.storage.sql.exec("SELECT body FROM messages").toArray();
    });
    expect(messages).toEqual([{ body: "from before" }]);
    expect(await roomSql(room, "SELECT name FROM d1_migrations")).toEqual([{ name: MIGRATIONS[0]!.name }]);
  });
});
