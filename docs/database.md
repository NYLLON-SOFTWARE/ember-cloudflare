# Database

How Ember stores its data, how that compares with ember-rust's database, and which of ember-rust's
choices to adopt as features land.

## Where the data lives

`STORAGE_BACKEND` in `apps/worker/wrangler.jsonc` picks the backend. With `do-sqlite` (the default),
each room's messages, boosts, recent revocations and deletions, and the changes the Workspace has yet
to hear of live in that room's Durable Object SQLite storage, and the account, people, their
sessions, rooms, memberships and the outbox of revocations in the Workspace object's. With `d1`, all
of them live in one D1 database. Both backends use the schema in `apps/worker/migrations/` and the
queries in `apps/worker/src/store.ts`, run through the driver in `apps/worker/src/db.ts`.

Each file in `apps/worker/migrations/` belongs to one kind of Durable Object, which `MIGRATIONS` in
`apps/worker/src/migrations.ts` names as its scope: `room` for messages, boosts, revocations, the
room's change log and its recent deletions, and `workspace` for the workspace-wide tables (the
account, people, sessions, rooms, memberships, pending revocations and the rooms deleted). On DO
SQLite, an object applies only its own scope's files, so a room's storage never holds workspace
tables. Wrangler applies every file to D1, where all the tables share one database and each room's
rows carry its `room_id`.

So far rooms keep `messages`, `boosts`, `revocations`, `room_events` and `message_deletions`, and
the Workspace keeps `accounts`, `users`, `sessions`, `rooms`, `memberships`, `pending_revocations`
and `deleted_rooms`. A room's id also names its Durable Object, and the Worker asks the Workspace
whether someone is a member before it wakes the room for their socket. First run creates the account
and its administrator, who signs in with an email address and password, found through the unique
index on `users.email_address`, as do the people who join with the join link; where it's allowed,
anyone can sign in with just a display name instead. Presence and typing live in each room object's
memory.

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
- **Stored sessions, refreshed hourly.** Each sign-in adds a `sessions` row with the browser and IP,
  and a request rewrites its `last_active_at`, browser and IP at most once an hour rather than every
  time, as ember-rust's `resume` does (`crates/ember/src/concerns.rs`). Signing out deletes the row,
  and in the same batch queues closing the session's sockets (see the outbox below).
- **Memberships are found by room and person, or by person.** ember-rust's unique
  `(room_id, user_id)` index is our primary key, which answers each socket upgrade's "is this person
  in this room?", and its `user_id` index is ours with `room_id` added, so listing someone's rooms
  reads only the index for their memberships. Its `room_id` index repeats the key's first column, and
  `(room_id, created_at)` orders a room's members, which nothing lists yet, so neither is here.
- **One account, kept to one by the database.** ember-rust's `accounts` has a `singleton_guard`
  column with a unique index, so a second account can't be inserted. Ours has it too: the Workspace
  runs one first run at a time on DO SQLite, but on D1 two can overlap, and the index refuses the
  second. The account's columns are ember-rust's: its name, its join code, its settings as JSON and
  its custom styles.
- **Unread marks are a column of the membership.** `memberships.unread_at` is when a room was marked
  unread for someone, null while it isn't, and one `UPDATE` marks every member a message should, as
  ember-rust's `unread_memberships` does (`crates/db/src/models/room.rs`). We skip its `connections`
  and `connected_at` columns: each room's object knows from its sockets who's viewing it, and sends
  that list with its messages. And ours writes only the rows it changes, so `unread_at` is the time
  of the first message since someone last read the room, where ember-rust rewrites every member who
  isn't connected with the newest; nothing reads it but to ask whether it's set.
- **No unbounded lists of bound values**
  ([`a8b713a`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/a8b713a) batches inserts under
  SQLite's limit). Our limit is lower: Durable Object SQLite and D1 bind at most 100 values a
  statement, and binding a page's message ids made a 100-message page fail on both.
- **Tabs that connect again find what changed through an index on messages.** ember-rust's refresh
  asks for the messages created or updated since a time, through an index on `(room_id, updated_at)`
  and boosts that touch their message's `updated_at`
  ([`57a44a9`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/57a44a9)). Ours asks since a
  number rather than a time, which no clock can skew (room migration 0015): each room numbers the
  changes to its messages, and the statement that makes a change gives its message the number in
  `change_seq`, which `(room_id, change_seq)` indexes, a reaction setting its message's. A tab that
  connects again names the latest number it has heard of, and the room reads the messages changed
  since through that index, the same few rows however big the room. Unlike ember-rust's, it hears of
  deletions too: a deleted message leaves its id with the deletion's number in `message_deletions`,
  and each deletion drops those more than 100 changes old. A tab more than 100 changes behind gets
  the newest page instead, where ember-rust's refresh stops at 40 new messages. Keeping every change
  as a row of its own, in a log of the latest 100, cost each new message two more statements and a
  room 13% of the messages it could take a second, so a new message writes no other row. The room is
  the only writer of its messages, so it counts from the latest number once it has read it, and reads
  it again after a batch fails, which D1 may have saved all the same. Our "(edited)" label reads
  `edited_at`, so a reaction leaves its message's times alone.

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
- **Names from the users table.** People have their own table now, but we still copy the sender's
  name into each message and boost. That's fine while names can't change, but renaming someone would
  leave the old name on their messages.

### Not adopting

- **Message bodies in their own table.** That's Rails' Action Text, and it costs a join or a second
  query on every page. Our bodies stay in `messages`.
- **Deleting a message's boosts in application code.** Rails deletes dependents itself; our foreign
  key cascades, so the database does it in the same statement.
- **SQLite tuning:** WAL checkpoints off the writer thread, the prepared-statement cache, no memory
  mapping. Cloudflare runs SQLite for both backends, so there's nothing for us to set.

### Ours alone

- **Bodies are stored as they show, with their plain text and whom they mention.** ember-rust keeps
  each body nearly as its sender wrote it, in `action_text_rich_texts`, and sanitizes it each time
  it renders one (`crates/ember/src/controllers/presenters.rs`). Our clients render, so the room
  sanitizes once, as a message is written or edited (`prepareBody` in `packages/richtext`):
  `messages.body` holds the markup it shows, `plain_text` its plain text, which ember-rust writes
  only to its search index, and `mentions` the ids of the people it mentions as a JSON array, so a
  page of history is sent without parsing anything. A paragraph of plain text, which is what the
  composer sends, is read without parsing it, in a few microseconds; parsing anything else costs a
  write about 0.1 ms of CPU, and up to 1 ms in a room that has just started. A body that can't be
  shown is refused rather than stored. `edited_at` is when
  a message's text last changed. Room migration 0012 turned the plain-text bodies from before it into
  the paragraph Lexxy sends for typed text, in SQL, and set `edited_at` from `updated_at` for the
  messages already edited.
- **Sessions keep a digest of their token.** ember-rust stores each session's token as it is and
  signs the cookie that carries it. We store an HMAC of the token, keyed by `SESSION_SECRET`, so a
  leaked database or backup holds no live sessions; changing the secret still signs everyone out, as
  it does there.
- **Passwords are PBKDF2-SHA256 digests.** ember-rust keeps bcrypt digests, which Workers could only
  make with bcrypt compiled to WebAssembly. Web Crypto has PBKDF2 built in, up to 100,000 iterations,
  so `users.password_digest` holds `$pbkdf2-sha256$i=100000$<salt>$<hash>` (the PHC string format):
  since it names its scheme and cost, a stronger one can take over by rehashing at sign-in. A hash
  takes tens of milliseconds of CPU, and a request on Workers Free gets 10 ms, so it runs in a
  `PasswordHasher` Durable Object made for it, whose requests get 30 seconds.
- **Guests are marked.** `users.guest` is 1 for people who signed in with just a name, which only this
  port allows, so turning `EMBER_GUEST_SIGN_IN` off keeps them out without deleting anyone.
- **Sessions are kept in memory.** ember-rust looks up each request's session in its database. Ours
  live in the Workspace, which every request and socket upgrade calls, and on D1 the lookup would
  add a round trip to each. So the Workspace keeps the 10,000 sessions used most recently
  (`apps/worker/src/session-cache.ts`) and reads the table only for the others. It changes every
  session itself, so the copy stays current; a session deleted by hand stays signed in until the
  Workspace restarts, which every deploy does, and changing `SESSION_SECRET` still signs everyone
  out.
- **Revocations go through an outbox.** ember-rust disconnects someone's connections in memory,
  through its cable server, once the change that ends their access is saved
  (`crates/ember/src/channels/revocation.rs`). Ours are spread over rooms' Durable Objects, which the
  Workspace has to call, and any call can fail. So the change also writes a `pending_revocations` row
  for each room, in the same batch, and the Workspace's alarm sends each room its own: up to 40 rows
  a run, six rooms at a time, putting a failed row off for 1 second, then 2, 4 and so on up to 5
  minutes, and giving it up after 10 tries, unless it deletes a room, which would leave the room's
  messages stored. Its index on `due_at` finds the rows that are due. The change sets the alarm
  even when D1's answer to it is lost, since it may have been saved anyway, and a Workspace that
  starts sets it for any rows waiting, which one that stopped in between leaves. A room keeps the
  time of each revocation it has had in `revocations` for five minutes. It turns away a socket the
  Workspace let through at or before one of them, which was checked just before the change and slow
  to arrive, and any socket let through over a minute before it arrives, which a revocation the room
  has since forgotten could cover.
- **Granting rooms is one statement.** ember-rust reads the ids of everyone a room takes in (or of
  every open room a new person joins) and inserts them 1,000 rows at a time. Our bound-value limit
  would cut that to a few dozen rows a statement, and on D1 the read is a round trip of its own, so
  each grant selects from `users` or `rooms` inside its `INSERT`, one statement however many there
  are.
- **Changing a room is one batch.** ember-rust saves a room's name and kind, then revises its
  members in a second write (`crates/ember/src/controllers/rooms/closeds.rs`), so a failure between
  the two leaves a private room with its old members. Ours renames the room, changes its kind, adds
  and takes out its people and queues closing the sockets of everyone taken out in one batch, which
  passes the members as one JSON value, so it binds the same few values however many there are.
- **Deleting a room takes two steps, and leaves its id behind.** ember-rust deletes a room's members,
  its messages and the room in one transaction (`crates/db/src/models/room.rs`). Ours live in
  different objects, so the Workspace deletes the room and its members, and queues closing every
  socket in it, in one batch, and the room's object deletes its messages, their boosts going through
  the foreign key, when that reaches it. The object keeps the time of the deletion for five minutes,
  as it keeps any revocation, then its alarm erases what's left; on DO SQLite that's all its storage,
  and an object with none ceases to exist. The Workspace records the room's id in `deleted_rooms`,
  since registering `LEGACY_ROOMS` would otherwise bring a deleted legacy room back.
- **A room's icon is a column of the room.** ember-rust keeps every room's icon in one JSON map in
  the account's settings (`ember_channel_icons`, `crates/db/src/models/account.rs`), so as not to
  change Campfire's tables, and rewrites the map to change one. Ours is `rooms.icon` (workspace
  migration 0009), null for the default `#`, read with the room and saved in the same batch as its
  name and access. As in ember-rust, saving the icon a room already has leaves `updated_at` alone.
- **Stars are rows of their own.** ember-rust keeps each person's starred rooms as a list in the
  account's settings (`ember_favorite_channels`, `crates/db/src/models/account.rs`) and rewrites the
  settings to star or unstar one. Ours is a `favorites` row for each star (workspace migration 0013),
  keyed by person and room, whose `position` orders them, so a star or unstar writes its row and
  bumps its person's `users.favorites_version`, in one batch. That version is how a tab keeps the
  newer of two lists of their stars, which can reach it in either order. Reordering them sets every
  `position` in one `UPDATE ... FROM json_each`, given the new order as one JSON value, so it binds
  the same few values however many stars there are, and changes nothing unless the order holds
  exactly their stars. As in ember-rust, a star outlives its person's membership: it's left out while
  they can't star the room, and dropped at their next star, unstar or reorder.
- **Rooms are named by their ids, and some have no creator.** A room's id names its Durable Object
  too, so it's a 16-character sortable string like a message's rather than an integer, and its kind
  is `open`, `closed` or `direct` rather than Rails' class name. The rooms from before the Workspace
  kept a list, which `LEGACY_ROOMS` registers, keep their old addresses as ids and have no creator.
- **The first room is found through an index.** The workspace's first room, where the welcome card
  shows, is its oldest, as ember-rust's `Room::original` is (`crates/db/src/models/room.rs`), which
  sorts every room by `created_at` to find it. Every sidebar here asks, so
  `index_rooms_on_created_at_and_id` (workspace migration 0014) finds it at once. Our ids sort by
  time too, but not the old addresses of the rooms `LEGACY_ROOMS` registers.
- **Each group of people has one DM, found by its key.** ember-rust finds a group's DM by reading
  every DM's members and comparing them with the group (`find_direct_for`,
  `crates/db/src/models/room.rs`), each time someone starts one. Ours keeps each DM's members' ids,
  sorted, as a JSON array in `rooms.direct_key` (workspace migration 0016), under a unique index.
  Starting a DM is one batch: it adds the room unless the key has one (`ON CONFLICT DO NOTHING`),
  puts the group in it only if it was added, and reads the DM the key names. So it costs the same
  however many DMs there are, and two people starting the same DM at once get one between them. A
  DM's members never change, so its key stays true.
- **A DM's place is the time of its latest message, which the Workspace writes as it applies it.**
  ember-rust lists DMs by `rooms.updated_at` (`crates/ember/src/controllers/presenters/accounts.rs`),
  which a message's edits, deletion and reactions touch too. Ours keeps when a DM's latest message
  came in `rooms.last_message_at` (workspace migration 0017), set by the statement that records the
  events a room sent (`applied_seq`, below) when they hold a message, and never moved back, so events
  sent again or late change nothing. Until a DM has one, it goes by `created_at`. The sidebar's
  statement reads the time with each room, so listing DMs in order costs nothing more.
- **Suggestions are one statement.** ember-rust reads the members of someone's DMs, then binds their
  ids to a `NOT IN` list to find the people to suggest (`direct_placeholder_users`, in the same file).
  Ours leaves them out with a subquery over the memberships of their DMs, so it binds one value
  however many DMs they have, and runs in the batch that reads the rest of the sidebar.
  `index_users_on_created_at_and_id` (workspace migration 0017) gives it people oldest first, so it
  stops at the nineteenth it can suggest rather than sorting everyone. The index leaves status out,
  since SQLite would otherwise read every active person through it, as New room's list does, rather
  than reading the table straight through.
- **Rooms send the Workspace their change logs.** ember-rust marks a room unread in the transaction
  that creates the message. Ours are in different objects, so a room logs each new message in
  `room_events`, in the batch that stores it, and each time someone opens it in a shown tab, then
  sends the Workspace its oldest events, up to 50 a call, and deletes them once they're applied. One
  call is out at a time, and after each the room waits up to 250 ms for more, less if the call was
  full or 50 more are logged sooner, so a room makes at most four calls a second until its calls
  fill. On D1 a call is three queries: reading the log, the Workspace's batch and the delete, all in
  the one database every room writes to. A call that fails is tried again by the room's alarm, after
  1 second, then 2, 4 and so on up to 5 minutes, and the room makes no other call meanwhile, however
  busy it is. The Workspace applies a call's events in one transaction and records the last in
  `rooms.applied_seq`, so events sent again, as when the room's answer is lost, change nothing; the
  log's `AUTOINCREMENT` keeps a number from coming back once its event is deleted. Reads go through
  the log too, so a read can't overtake the message before it.
- **Messages are indexed by `(room_id, client_message_id)`.** ember-rust posts each message over
  HTTP and knows one wasn't stored when its request fails. Ours go over the room's WebSocket, which
  can close after the room stored a message but before its confirmation arrived, so after a
  reconnect the client asks the room which of its unconfirmed messages it has (`message.check`).
  The index keeps that lookup at about 0.05 ms however big the room gets, where reading every
  message took 12 ms at 100,000 messages. It costs each stored message about 60 bytes and 4 µs.

## Writing SQL here

- A write that has to be atomic is one `db.batch([...])`: it runs inside `transactionSync` on DO
  SQLite and is D1's `batch()`, so its statements all take effect or none do. D1 has no other kind
  of transaction, so don't read, decide in code and then write. Make each statement check its own
  conditions instead, with a unique index, `INSERT … SELECT … WHERE NOT EXISTS` or
  `UPDATE … WHERE … RETURNING`.
- Use one statement per query shape. SQLite can't use an index through an optional filter like
  `? IS NULL OR id < ?`.
- Never bind a list whose length depends on the data. Both backends bind at most 100 values a
  statement; use a subquery, or JSON built in SQL, instead.
- When a query has to stay fast as a room grows, check its plan with `EXPLAIN QUERY PLAN` in a test,
  as `apps/worker/test/messages.test.ts` does for history pages.
