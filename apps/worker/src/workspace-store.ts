import type { User } from "@ember/protocol";
import { statement, type Db } from "./db";

// People and sessions, kept by the Workspace in its own SQLite storage or in D1 (see db.ts).

/** The browser and IP a session records. */
export interface Client {
  ip: string | null;
  userAgent: string | null;
}

/** ember-rust's user statuses (crates/db/src/models/user.rs). Only active people can sign in. */
const ACTIVE = 0;

interface SessionRow {
  session_id: string;
  last_active_at: string;
  user_id: string;
  name: string;
}

const INSERT_SESSION = `INSERT INTO sessions (id, user_id, token_digest, ip_address, user_agent, last_active_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export class WorkspaceStore {
  constructor(private readonly db: Db) {}

  /** Adds a guest, who has a name but no way to sign in again, together with their session. */
  async createGuest(user: User, sessionId: string, tokenDigest: string, client: Client, now: string): Promise<void> {
    await this.db.batch([
      statement(`INSERT INTO users (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`, user.id, user.name, now, now),
      statement(INSERT_SESSION, sessionId, user.id, tokenDigest, client.ip, client.userAgent, now, now, now),
    ]);
  }

  /** The session a token's digest names, if its person is still active. */
  async findSession(tokenDigest: string): Promise<SessionRow | null> {
    const [row] = await this.db.all<SessionRow>(
      `SELECT sessions.id AS session_id, sessions.last_active_at, users.id AS user_id, users.name
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_digest = ? AND users.status = ?`,
      tokenDigest,
      ACTIVE,
    );
    return row ?? null;
  }

  /** Records that the session is in use from `client`, as ember-rust's `resume` does. */
  async touchSession(id: string, client: Client, now: string): Promise<void> {
    await this.db.run(
      `UPDATE sessions SET last_active_at = ?, ip_address = ?, user_agent = ?, updated_at = ? WHERE id = ?`,
      now,
      client.ip,
      client.userAgent,
      now,
      id,
    );
  }

  async deleteSession(tokenDigest: string): Promise<void> {
    await this.db.run(`DELETE FROM sessions WHERE token_digest = ?`, tokenDigest);
  }
}
