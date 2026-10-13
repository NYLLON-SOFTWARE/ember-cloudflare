# Database

How Ember stores its data, how that compares with ember-rust's database, and which of ember-rust's
choices to adopt as features land.

## Where the data lives

`STORAGE_BACKEND` in `apps/worker/wrangler.jsonc` picks the backend. With `do-sqlite` (the default),
each room's messages and boosts live in that room's Durable Object SQLite storage. With `d1`, every
room's messages and boosts live in one D1 database. Both backends use the schema in
`apps/worker/migrations/` and the queries in `apps/worker/src/store.ts`.

So far only messages and boosts are stored. People sign in by display name, rooms come from
`DEFAULT_ROOMS`, and presence and typing live in each room object's memory.

## Compared with ember-rust

ember-rust keeps Campfire's Rails schema in one SQLite file
([`crates/db/src/schema.sql`](https://github.com/NYLLON-SOFTWARE/ember-rust/blob/main/crates/db/src/schema.sql)):
accounts, users, sessions, rooms, memberships, messages with their bodies in `action_text_rich_texts`,
boosts, bans, webhooks, push subscriptions, searches, Active Storage tables for files, and an FTS5
search index. On top of that schema it adds indexes and query changes for speed.

### Adopted

- **History pages seek an index from the cursor.** The newest page and the page before a message are
  separate statements, as ember-rust's `last_page` and `page_before` are
  ([`aa3b894`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/aa3b894)). Our single statement
  with `? IS NULL OR id < ?` walked the room from its newest message down to the cursor. In a
  100,000-message room, a page near the start took 8.1 ms and now takes 0.27 ms, the same as the
  newest page.
- **One round trip where there were two**
  ([`6bfee19`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/6bfee19)). A page's boosts come
  from a subquery in the same statement, so a page or a message lookup is one D1 round trip, not two.
- **No unbounded lists of bound values**
  ([`a8b713a`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/a8b713a) batches inserts under
  SQLite's limit). Our limit is lower: Durable Object SQLite and D1 bind at most 100 values a
  statement, and binding a page's message ids made a 100-message page fail on both.

### Already equivalent

- **Is there another page?** ember-rust asks for one row past the page instead of counting the room;
  we fetch one more row than the page holds.
- **A created message answers with the row it stored**
  ([`2e7f20d`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/2e7f20d)) rather than reading it
  back.
- **Boosts are indexed by message**, as `index_boosts_on_message_id` is there.

### To adopt with the feature that needs it

- **Search:** an FTS5 table with the porter tokenizer, keyed by message id, written when a message is
  created, edited or deleted. Search walks the index from its newest match and stops once a page is
  full ([`4c2ac40`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/4c2ac40)), and quotes each
  word so `AND`, `OR` or `NEAR` can't break the query.
- **Integer ids**, with search. FTS5 keys its rows on integer ids, and ours are 16-character
  sortable strings. At 100,000 messages, `INTEGER PRIMARY KEY AUTOINCREMENT` made the database 25%
  smaller (19.7 MB against 26.2 MB), with about the same write speed and the same rows written per
  insert.
  Switching takes a migration that renumbers stored messages and their boosts.
- **Catching up after a reconnect:** an index on `(room_id, updated_at)`, and boosts that touch their
  message's `updated_at`, so a client asks for what changed since it left
  ([`57a44a9`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/57a44a9)). Our "(edited)" label
  reads `updated_at`, so it would need its own edit time first.
- **Users in their own table, with real accounts.** We copy the sender's name into each message and
  boost. That's fine while names can't change, but renaming someone would leave the old name on their
  messages.
- **Stored sessions:** a `sessions` table whose `last_active_at` is written at most once an hour,
  not on every request. Our session tokens are signed and stored nowhere, so signing one person out
  means changing the secret for everyone.
- **Unread rooms:** `memberships.unread_at`, set by one `UPDATE` per message for members who aren't
  connected. ember-rust records who's connected in `memberships.connections` and `connected_at`;
  each of our rooms is one object that already knows who's connected, so we can skip those two
  columns.

### Not adopting

- **Message bodies in their own table.** That's Rails' Action Text, and it costs a join or a second
  query on every page. Our bodies stay in `messages`.
- **Deleting a message's boosts in application code.** Rails deletes dependents itself; our foreign
  key cascades, so the database does it in the same statement.
- **SQLite tuning:** WAL checkpoints off the writer thread, the prepared-statement cache, no memory
  mapping. Cloudflare runs SQLite for both backends, so there's nothing for us to set.

## Writing SQL here

- Use one statement per query shape. SQLite can't use an index through an optional filter like
  `? IS NULL OR id < ?`.
- Never bind a list whose length depends on the data. Both backends bind at most 100 values a
  statement; use a subquery, or JSON built in SQL, instead.
- When a query has to stay fast as a room grows, check its plan with `EXPLAIN QUERY PLAN` in a test,
  as `apps/worker/test/chat-room.test.ts` does for history pages.
