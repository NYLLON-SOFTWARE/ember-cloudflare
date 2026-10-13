import messages from "../migrations/0001_messages.sql";

/**
 * Every file in migrations/, oldest first. D1 gets them from `wrangler d1 migrations apply`; a room's
 * Durable Object applies the ones its storage is missing when it opens. A test checks this list
 * against the directory.
 */
export const MIGRATIONS = [{ name: "0001_messages.sql", sql: messages }];

/**
 * Applies the migrations a Durable Object's storage is missing, recording each in the table wrangler
 * keeps for D1. Objects from before this table existed ran 0001 already; it only creates what's
 * missing, so it runs again harmlessly and is recorded.
 */
export function migrate(storage: DurableObjectStorage): void {
  storage.sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`);
  const applied = new Set(storage.sql.exec<{ name: string }>("SELECT name FROM d1_migrations").toArray().map((row) => row.name));
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    storage.transactionSync(() => {
      storage.sql.exec(migration.sql);
      storage.sql.exec("INSERT INTO d1_migrations (name) VALUES (?)", migration.name);
    });
  }
}
