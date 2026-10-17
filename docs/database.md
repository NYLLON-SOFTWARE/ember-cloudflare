# Database

How Ember stores its data, how that compares with ember-rust's database, and which of ember-rust's
choices to adopt as features land.

## Where the data lives

`STORAGE_BACKEND` in `apps/worker/wrangler.jsonc` picks the backend. With `do-sqlite` (the default),
each room's messages, boosts, recent revocations and deletions, its files' records, and the changes
the Workspace and the search index have yet to hear of live in that room's Durable Object SQLite
storage, and the account, people, their sessions, browsers' push subscriptions, bots' webhooks, bans
and recent searches, rooms, memberships and the outbox of revocations, purges and reindexes in the
Workspace object's. With `d1`, all of them live in one D1 database. Both backends use the schema in
`apps/worker/migrations/` and the queries in `apps/worker/src/store.ts`, run through the driver in
`apps/worker/src/db.ts`. The search index is the exception: it keeps its tables in the `SearchIndex`
object's own SQLite storage on either backend, since D1 can't export a database that holds a virtual
table, as its FTS5 table is. The files themselves live in R2, in the bucket bound as `FILES`.

Each file in `apps/worker/migrations/` belongs to one kind of Durable Object, which `MIGRATIONS` in
`apps/worker/src/migrations.ts` names as its scope: `room` for messages, boosts, revocations, the
room's change log, its log of messages for the search index, its recent deletions and its files, and
`workspace` for the workspace-wide tables (the account, people, sessions, push subscriptions,
webhooks, bans, recent searches, rooms, memberships, stars, pending revocations, purges and
reindexes, and the rooms deleted). On DO SQLite, an object applies only its own scope's files, so a
room's storage never holds workspace tables. Wrangler applies every file to D1, where all the tables
share one database and each room's rows carry its `room_id`. The search index's schema is in
`apps/worker/search-migrations/`, which only the index applies, listed in `SEARCH_MIGRATIONS`.

So far rooms keep `messages`, `boosts`, `revocations`, `room_events`, `unindexed_messages`,
`message_deletions` and `blobs`, the Workspace keeps `accounts`, `users`, `sessions`, `push_subscriptions`,
`webhooks`, `bans`, `searches`, `rooms`, `memberships`, `favorites`, `pending_revocations`,
`pending_purges`, `pending_reindexes` and `deleted_rooms`, and the search index keeps
`search_messages`, `search_rooms` and the FTS5 table `search_index`. A room's id also names its
Durable Object, and the Worker asks the Workspace whether someone is a member before it wakes the
room for their socket. First run creates the account and its administrator, who signs in with an
email address and password, found through the unique index on `users.email_address`, as do the
people who join with the join link; where it's allowed, anyone can sign in with just a display name
instead. Presence and typing live in each room object's memory.

## Compared with ember-rust

ember-rust keeps Campfire's Rails schema in one SQLite file
([`crates/db/src/schema.sql`](https://github.com/NYLLON-SOFTWARE/ember-rust/blob/main/crates/db/src/schema.sql)):
accounts, users, sessions, rooms, memberships, messages with their bodies in `action_text_rich_texts`,
boosts, bans, webhooks, push subscriptions, searches, Active Storage tables for files, and an FTS5
search index. On top of that schema it adds indexes and query changes for speed.

### Adopted

- **History pages seek an index from the cursor.** The newest page and the pages before and after a
  message are separate statements, as ember-rust's `last_page`, `page_before` and `page_after` are
  ([`aa3b894`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/aa3b894)), and the page around a
  message, which its permalink opens, is the message and the pages either side of it, read side by
  side, as its `page_around` is. Our single statement with `? IS NULL OR id < ?` walked the room from
  its newest message down to the cursor. In a 100,000-message room, a page near the start took
  8.1 ms and now takes 0.27 ms, the same as the newest page.
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
- **Search is one FTS5 table, read from its newest match.** As ember-rust's `message_search_index`
  (`crates/db/src/schema.sql`), it's an FTS5 table with the porter tokenizer holding each message's
  plain text, and a search quotes each word, so that every word has to match and none is read as
  FTS5's syntax, such as `NOT` or `NEAR`. As ember-rust's search does since
  [`4c2ac40`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/4c2ac40), it reads the newest
  1,000 matches off the index, wherever they are, keeps the newest 100 in rooms the searcher is in,
  and only when those 1,000 hold fewer and there may be more does it ask for just those rooms'
  matches, by whatever plan SQLite picks. The rooms go to it as one JSON value. ember-rust numbers
  the index's rows by message id, which grows with time. Ours are strings, and each room's messages
  reach the index on their own schedule, so the index numbers the messages it takes itself
  (`search_messages`): a message's time in milliseconds, times 1,024, plus its place among that
  millisecond's. Walking the index from its largest number then goes from the newest message,
  whichever room it's in and however late it came, with nothing to sort, which a test checks with
  `EXPLAIN QUERY PLAN`, and an edit keeps its number. The index reads the first query a match at a
  time, as ember-rust's loop does, and stops at a full page. Over 100,000 messages in 50 rooms, a
  search for a word in a quarter of them takes 0.3 ms of SQLite for someone in every room, where
  reading all 1,000 matches took 1.2 ms; for someone in one of the 50, reading the 1,000 and then
  their room's matches takes about 12 ms. A word in one message takes 0.03 ms.

### Already equivalent

- **Is there another page?** ember-rust asks for one row past the page instead of counting the room;
  we fetch one more row than the page holds.
- **A created message answers with the row it stored**
  ([`2e7f20d`](https://github.com/NYLLON-SOFTWARE/ember-rust/commit/2e7f20d)) rather than reading it
  back.
- **Boosts are indexed by message**, as `index_boosts_on_message_id` is there.

### To adopt with the feature that needs it

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
- **Integer message ids.** ember-rust's search index is numbered by message id, an integer. Ours
  numbers its messages itself (above), so ids stay 16-character sortable strings, which each room
  makes alone, where integers shared by every room's messages would need one counter they all ask.
  At 100,000 messages, `INTEGER PRIMARY KEY AUTOINCREMENT` made a room's storage 25% smaller
  (19.7 MB against 26.2 MB), which isn't worth renumbering every stored message, its boosts and the
  links to it.

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
- **Bans are ember-rust's `bans`.** Banning someone records each address on their sessions in a
  `bans` row (workspace migration 0018), with ember-rust's indexes: by address, which a room socket's
  check reads, and by person, which lifting the ban deletes. They're written in the batch that ends
  the person's sessions, marks them banned and queues closing their sockets and deleting their
  messages, the addresses going to the `INSERT` as one JSON value, so it binds the same few values
  however many sessions there were.
- **Banned addresses are kept in memory.** ember-rust reads `bans` for every request that would
  change something (`crates/ember/src/concerns.rs`). Here the Worker asks the Workspace before each
  such request, and the Workspace answers from the set of banned addresses it keeps, so the check
  costs that call but never a database read, even on D1. It reads the set again after a ban or a
  lifted ban, and doesn't keep a read that one overtook. A room socket's check reads the address's
  ban in the statement that already reads the person's membership, so it costs nothing more and
  never waits on that set. Banning addresses, or lifting
  their ban, queues closing the sockets from each in every room: one `INSERT ... SELECT` joins
  `rooms` with the addresses, sent as one JSON value, writing a `pending_revocations` row for each.
- **A ban deletes messages through the outbox, a page at a time.** ember-rust's
  `RemoveBannedContentJob` (`crates/ember/src/jobs.rs`) finds a banned person's messages through
  `index_messages_on_creator_id` and deletes them one by one. Ours are spread over rooms, so the
  batch that bans someone writes a `pending_purges` row for every room they could have written in:
  every shared room, since they may have left one, and each DM of theirs. The Workspace's alarm asks
  each room to delete 100 of their messages at a time, each deletion a change of its own that tabs
  catch up on, and asks again at once while the room has more, so a big room never holds the room's
  object for long. It delivers revocations first, and 40 rows a run in all, and puts off a room it
  can't reach as it does a revocation, but never gives up, which would leave the messages up. Nor does
  it ask a room while that room has sockets left to close, so a banned person can't write through one
  after their purge there is done; the room's purges wait for its revocations, and are due no sooner.
  Deleting a room drops its purges, since its messages all go anyway, so their ids are
  `AUTOINCREMENT`, never handed out again: the alarm settles a purge by its id once the room has
  answered, and a ban meanwhile could otherwise give a new purge the id of one deleted with its room.
  Lifting the ban records when on each purge still waiting, and the room then deletes only what they
  wrote by then, as ember-rust's job only finds what they'd written when it ran, at once. What they
  write once they're back stays however late a room answers, and what a socket of theirs sent before
  the room closed it still goes.
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
- **A room's place in the shared order is a column of the room.** ember-rust keeps the order
  administrators set for everyone as a list of ids in the account's settings
  (`ember_default_room_order`, `crates/db/src/models/account.rs`), which every sidebar reads whole and
  filters to the rooms its person can see. Ours is `rooms.shared_position` (workspace migration 0020),
  so the sidebar's statement reads each room's place with the room, and listing the order costs
  nothing more, nor reads the places of rooms someone isn't in. Saving it reads the order, with
  whether the administrator could order each room in it, merges their list in as ember-rust does,
  then numbers every room it ranks in one `UPDATE ... FROM json_each`, skipping those already in
  place, and unranks the rest in another, given the merged order as one JSON value, so it binds the
  same few values however many rooms it ranks. The Workspace saves it one at a time with the changes
  that decide who can see a room, so nothing comes between the read and the writes. A deleted room
  leaves the order with its row, where ember-rust's list keeps its id. Whether only administrators
  create rooms stays in the account's settings, as in ember-rust, and the Workspace keeps it with the
  rest of the account it has read.
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
- **Messages are indexed by `(room_id, creator_id, client_message_id)`.** ember-rust posts each
  message over HTTP and knows one wasn't stored when its request fails. Ours go over the room's
  WebSocket, which can close after the room stored a message but before its confirmation arrived, so
  after a reconnect the client asks the room which of its unconfirmed messages it has
  (`message.check`). The index keeps that lookup at about 0.05 ms however big the room gets, where
  reading every message took 12 ms at 100,000 messages. Banning someone finds their messages through
  it too, as ember-rust's `index_messages_on_creator_id` does: a page of one person's messages in a
  100,000-message room takes 0.06 ms, where room migration 0002's `(room_id, client_message_id)`
  would read the whole room's, 7.8 ms. Room migration 0019 put it in that index's place, so a new
  message writes one index, as before: about 80 bytes of it, 20 more than before, in the same 4 µs.
- **The search index is a Durable Object of its own, with its own storage.** ember-rust's index is a
  table in its one database. Ours is the `SearchIndex` object, as an FTS5 query over a big index can
  take milliseconds that no room or the Workspace should wait for, and its tables stay in that
  object's SQLite storage on either backend: D1 can't export a database that holds a virtual table,
  which would leave a D1 deployment with no export. So its schema is in
  `apps/worker/search-migrations/`, which wrangler never applies to D1, listed in `SEARCH_MIGRATIONS`.
- **Rooms send the search index their changes through a log of their own.** ember-rust writes its
  index after the transaction that changes a message commits (`crates/db/src/models/message.rs`).
  Ours is in another object, so the batch that writes, edits or deletes a message logs its id in
  `unindexed_messages` (room migration 0021), and the room sends the index those messages as they are
  by then, the same way it sends the Workspace its change log (above): 50 at a time, one call out,
  and its alarm trying a failed call again, deleting them once the index has them. But it waits its
  250 ms before each call rather than after, so a search finds a new message about a quarter of a
  second after it's written, rather than as the Workspace hears of it. With the index's calls going at
  once, timing each step of the perf suite's `unread` scenario on D1 showed the Workspace's call for a
  quiet room's first message starting 8 ms later, behind the index's. With them waiting, it starts as
  it did before the index, and the first unread mark took 28 ms (median of eight runs) against 25
  before, inside the 20 to 40 ms it spreads over between runs of either. The index takes a call in one
  batch and records the last entry it took from each room in `search_rooms`, so a call that arrives
  after a later one changes nothing, and a deleted room's is set past any number, so a late call can't
  bring its messages back. A message the room no longer has leaves the index.
- **Messages from before the index are logged once, through the Workspace's outbox.** Workspace
  migration 0022 queues a `pending_reindexes` row for every room, as registering a legacy room does,
  and the Workspace's alarm asks each room to log all its messages, after the revocations and purges
  it delivers, putting off a room it can't reach as it does a purge, but never giving up.
- **Search results are read where their messages are.** ember-rust reads the matching messages in
  the query that finds them. Ours are elsewhere, so on DO SQLite the Worker asks each room with
  matches for its own, six rooms at a time, and on D1 it reads them all in one query, by id. Either
  way, a message deleted since the index heard of it is left out. In the perf suite's `search`
  scenario, searching ten rooms of 100 messages for a word in a quarter of them took 14 ms (p50) on DO
  SQLite, against 6 ms for a word in none, so reading the newest 100 from their rooms is about half of
  it; on D1, where one query reads them, 11 ms against 8.
- **Each person has a recent search once, ordered by a number.** ember-rust's `searches` gives each
  a row id, looks a search up before touching it or adding it, and orders them by when they were last
  searched for (`crates/db/src/models/search.rs`). Ours are keyed by person and search (workspace
  migration 0023), so recording one is one upsert that numbers it one past the person's highest, and
  two searches can't tie, as two in the same instant could by time. The batch that records it also
  forgets all but the newest 10 and reads them back with the rooms the search needs, so searching
  takes the Workspace one round trip, as it did before searches were recorded.
- **Each browser's subscription is saved once, in one statement.** ember-rust's `push_subscriptions`
  looks a subscription up by its endpoint and keys before adding it or touching it, with an index on
  those three and another on the person (`crates/db/src/models/push_subscription.rs`), so two saves
  at once can add it twice. Ours requires the endpoint and keys, which its columns don't, and has one
  unique index on the person, the endpoint and the keys (workspace migration 0024), so saving is one
  upsert, and the same index, led by the person, lists someone's subscriptions and finds the one a
  browser names as it signs out. Like ember-rust's, they're numbered with `AUTOINCREMENT` (workspace
  migration 0026), since a push service answers that a subscription is gone only after the push to it
  went out, and the Workspace then forgets it by its number, which SQLite would otherwise give the
  next subscription saved once the newest is deleted.
- **A message's pushes are found as the Workspace applies its event.** ember-rust's push job loads
  the message again once it's stored, then its room's memberships, people and subscriptions, and
  counts each recipient's unread rooms for the badge (`crates/db/src/models/push_subscription.rs`).
  Ours names the message in its `room_events` row (room migration 0025), so the query that reads the
  room's log reads each message's plain text and mentions with it, by the message's key, as they are
  then; a message deleted since has none, and isn't pushed. The Workspace finds a message's
  recipients and badges in one query, in the batch that applies the room's events, just after the
  message's unread marks, through the memberships' key, the subscriptions' index led by the person
  and, for the badge, `index_memberships_on_user_id_and_room_id`. So pushes add no round trip to
  either object.
- **A bot is found by its id, so its token needs no index.** ember-rust keeps a bot's token in
  `users.bot_token` under a unique index, and finds the bot a key names by its id and token together
  (`authenticate_bot` in `crates/db/src/models/user.rs`). Ours keeps the token in the same column
  (workspace migration 0027) without the index: a key is the bot's id and its token, so the primary
  key finds the bot, and two bots with the same token would still have different keys. A bot has at
  most one webhook, so `webhooks` is keyed by the bot, where ember-rust's numbers its rows and
  indexes their `user_id`, and a bot has a row only while it has a URL to deliver to, where
  ember-rust saves an empty one for a bot added without a URL, whose deliveries fail.
- **A file's record lives in its room, and R2 keeps what serving it needs.** ember-rust keeps every
  file in Active Storage's `active_storage_blobs`, numbered, with its key under a unique index and an
  MD5 checksum, and finds a blob by its signed id to serve it. Ours keeps the room's files in its own
  `blobs` (room migration 0028), keyed by Active Storage's 28-character key, which R2 names the file
  by too (`files/<key>`). R2 keeps the file's type and name with it, and its address is signed with
  its key, so serving a file reads nothing but R2. `metadata` is the JSON Active Storage writes, and
  R2's ETags stand in for the checksum. A file goes up in parts (`apps/worker/src/files/uploads.ts`),
  so the row also keeps R2's multipart upload and the parts it has, as JSON, until `completed_at` says
  R2 has put them together. Deleting a room deletes its rows; its files in R2 go with plan 7.6.
- **A message's file is part of its row.** ember-rust attaches a file to its message through Active
  Storage's `active_storage_attachments`, and its presenter looks up each message's file on a page
  with a query of its own (`Blob::attached` in `crates/ember/src/controllers/presenters.rs`), which on
  D1 would cost a round trip for each message. A message has at most one file, so ours keeps it as the
  message shows it, as JSON in `messages.attachment` (room migration 0029): its key, name, type, size,
  and an image's width and height. A page of messages reads no other table for it, and its addresses
  are signed as the page is answered. An upload's row in `blobs` keeps the id the app gave its message
  and, once the room posts it, the message's, so a part sent again answers with the same message.

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
