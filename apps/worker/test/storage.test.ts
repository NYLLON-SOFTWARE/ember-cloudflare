import { feature } from "@ember/parity";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api, connect, freshRoom, post } from "./support";

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
});
