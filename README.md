# Ember

A Slack-like real-time chat app that runs entirely on Cloudflare: a React app served by a Worker,
with one Durable Object per room holding its WebSockets, presence, typing state and messages.

The design and UX are ported from [ember-rust](https://github.com/NYLLON-SOFTWARE/ember-rust),
NYLLON's Rust fork of Campfire. That repository is the reference for how things should look and
behave; this one rebuilds it on Workers and Durable Objects.

## Layout

| Path | Package | What |
|---|---|---|
| `apps/web` | `@ember/web` | React + Vite + Tailwind CSS v4 + shadcn/ui. The workspace UI. |
| `apps/worker` | `@ember/worker` | The Worker (`/api/*`, `/up`, the app's pages with ember-rust's headers and Campfire's error pages, the web app manifest, static assets) and the `ChatRoom`, `Workspace`, `SearchIndex`, `PasswordHasher` and `Unfurler` Durable Objects. |
| `packages/protocol` | `@ember/protocol` | WebSocket frame types and validation shared by both, and the addresses of the app's pages. |
| `packages/richtext` | `@ember/richtext` | Message bodies as Campfire's Action Text reads them: sanitizing, plain text, mentions and emoji-only bodies, golden-tested against ember-rust's corpus of Rails outputs. |

```
browser ──HTTP──▶ Worker ──▶ static assets (apps/web/dist)
   │                ├─────▶ Workspace Durable Object (one: the account, people, sessions, rooms, memberships,
   │                │        each tab's workspace socket, and the outbox that closes sockets in every room
   │                │        when access ends)
   │                ├─────▶ SearchIndex Durable Object (one: every message's plain text in an FTS5 table,
   │                │        in its own SQLite storage, which each room sends its changes)
   │                │
   └──WebSocket─────┴──▶ ChatRoom Durable Object (one per room, by id)
                            ├─ sockets, presence, typing (hibernation API)
                            └─ messages + boosts ─▶ DO SQLite (default) or D1
```

## Getting started

Requires Node 22.22.2+, 24.15+ or 26+ (jsdom's supported versions) and pnpm 10.

```sh
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm dev            # wrangler dev on :8787 and Vite on :5173 (proxies /api)
```

Open http://localhost:5173 and set up Ember: the first visitor creates the workspace's administrator
and its rooms, general and random. Then open a second browser, pick a name, and chat with yourself.

```sh
pnpm typecheck
pnpm test           # unit tests and the parity check; worker tests run in workerd, once per storage backend
pnpm build
```

## Browser tests

`e2e/` drives the production build in Chromium, against `wrangler dev` on :8788 with its own
state in `e2e/.wrangler`. Every suite shares `e2e/playwright.config.ts` and `e2e/fixtures.ts`
(sign in, an isolated room, other participants over a real WebSocket); each adds its projects
from `e2e/projects/` and its specs under `e2e/tests/<suite>/`.

```sh
pnpm --filter @ember/e2e exec playwright install chromium   # once
pnpm test:e2e       # every suite
pnpm test:features  # just the feature-by-feature suite, on a desktop browser
pnpm test:mobile    # just the phones
pnpm screenshots    # remakes the web app manifest's screenshots
```

Before the other suites start, the `first-run` project sets up the test server through the Set up
Ember page, as its first visitor would. The `workspace-settings` suites, which change the whole
workspace, get a second server, over HTTPS, which the same first run sets up.

The features suite (`e2e/tests/features/`) has a spec per area of [PARITY.md](PARITY.md). Each test gets
rooms of its own, and `members.signIn` opens a browser per person, so tests can chat, react and watch
each other type without seeing another test's messages.

The mobile suite (`e2e/tests/mobile/`) emulates seven phones, from a 320px iPhone SE to an iPhone
17 Pro Max on its side, with their notches, home indicators and on-screen keyboards. On every
screen it checks that nothing overflows sideways or sits under the notch, that every control is a
44px tap target, and that text fields are 16px so iOS doesn't zoom in on focus. Where a browser is
already installed, point Playwright at it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

The screenshots suite (`e2e/tests/screenshots/`) makes the screenshots the web app manifest lists,
which an install prompt shows: a few people chatting, on a phone. `pnpm screenshots` saves them over
`apps/web/public/screenshots/`, and every other run with the test's results, so they keep working.

## Parity with ember-rust

[PARITY.md](PARITY.md) lists every feature of ember-rust, whether this port has it, and the tests
that check it. It's generated from `packages/parity/src/features.ts`, where each feature has the
behaviors a port has to match, the ember-rust and Campfire files they come from, and a note on
anything this port does differently. Tests name the feature they cover:

```ts
describe(feature("messages.edit"), () => { ... });       // Vitest
test.describe(feature("messages.edit"), () => { ... });  // Playwright
```

`pnpm test` fails when a ported or partial feature has no test, when a test names a feature that
isn't listed, or when PARITY.md is out of date. After changing a feature or its tests, run
`pnpm parity` to regenerate it.

## Performance

`pnpm perf` load-tests the Worker under `wrangler dev` on both storage backends (latency,
throughput, fan-out, room size, history paging, search) and measures how the web app loads and renders a
busy room. `perf/README.md` explains the scenarios and how to compare two runs; the numbers the
suite started with are in `perf/baseline/report.md`.

## Storage: Durable Object SQLite or D1

`STORAGE_BACKEND` in `apps/worker/wrangler.jsonc` picks where messages live.

- **`do-sqlite`** (default): each room's Durable Object keeps its messages in its own SQLite
  storage. Nothing to provision, and reads and writes never leave the object.
- **`d1`**: messages go to one shared D1 database, which makes cross-room queries (activity,
  exports) straightforward. Create the database with `wrangler d1 create ember`,
  uncomment the `d1_databases` block, set `STORAGE_BACKEND` to `"d1"`, and apply
  `apps/worker/migrations/` with `pnpm --filter @ember/worker d1:migrate:local` (or `--remote`).

Both use the same schema (`apps/worker/migrations/`) and the same queries
(`apps/worker/src/store.ts`); only the driver (`apps/worker/src/db.ts`) differs. The Workspace
object's tables follow the same setting. The search index's don't: it keeps every room's messages in
one FTS5 table in the `SearchIndex` object's own storage, since D1 can't export a database that holds
one. [`docs/database.md`](docs/database.md) compares them with ember-rust's database.

## Deploying

```sh
pnpm --filter @ember/worker exec wrangler secret put SESSION_SECRET
pnpm run deploy        # not `pnpm deploy`, which is pnpm's own command
```

Then open `https://<your Worker>` and set up Ember. As in Campfire, setup is open to whoever has
the address until someone sets Ember up, and they become its administrator, so do it as soon as
it's deployed. There's no setup link or token to keep: Ember leaves out ember-rust's.

The setup form suggests Kevin Rose and kevin@kevinrose.com for the administrator, where ember-rust's
suggests Jane Cooper. To suggest your own, set the Worker's `EMBER_SETUP_NAME_PLACEHOLDER` and
`EMBER_SETUP_EMAIL_PLACEHOLDER` variables, in `vars` in `apps/worker/wrangler.jsonc` for instance.

The administrator then signs in at `/session/new` with the email address and password they set up
with, and invites people with the join link on general's welcome card.

Ember insists on HTTPS, as ember-rust does: plain HTTP is redirected to the same address over HTTPS,
and every answer from the Worker carries HSTS, except on `localhost` and loopback addresses, where
`wrangler dev` serves. To serve plain HTTP anywhere else, such as `wrangler dev --ip 0.0.0.0` for a
phone on your network, set the `DISABLE_SSL` variable to any value. `/up` answers 200 for uptime
checks, as Rails' does, without touching storage.

### Push notifications

Push notifications need a VAPID key pair. `pnpm vapid:keys` prints a new one as the Worker's two
settings, for `apps/worker/.dev.vars` or its secrets:

```sh
pnpm vapid:keys
pnpm --filter @ember/worker exec wrangler secret put VAPID_PUBLIC_KEY
pnpm --filter @ember/worker exec wrangler secret put VAPID_PRIVATE_KEY
```

Without them push is off, and `/api/health` says why. Keep the pair once people use it: browsers
subscribe with its public key, so a new pair leaves everyone to turn notifications on again. A pair
from ember-rust's `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` works as it is.

A new message is pushed from its room's Durable Object as the room tells the Workspace of it, to the
subscriptions of the members who aren't viewing the room and want to hear of it. Push services may
contact whoever `VAPID_SUBJECT` names, a `mailto:` or `https:` address, about your pushes; without it
they see this project's address. Each push is an outgoing request, of which the Workers Free plan
allows 50 per invocation, so there the pushes past that, for a message with more subscribers or a run
of messages sent together, fail and are logged; the Paid plan allows 10,000.

### Files

The files people upload go to an R2 bucket, bound as `FILES` in `apps/worker/wrangler.jsonc` and
named `ember`. Turn R2 on for your Cloudflare account, then deploy: Wrangler binds the account's
bucket of that name, and creates it if there's none and its token may, or make it yourself first
with `pnpm --filter @ember/worker exec wrangler r2 bucket create ember`. Change `bucket_name` to use
another. `wrangler dev` keeps files on your machine. Without the binding Ember keeps no files, and
`/api/health` says so.

A file goes up in parts of 10 MiB, since a Worker takes at most 100 MB a request, and R2 puts them
back together. R2 deletes the parts of an upload nobody finishes after a week.

### A preview from GitHub Actions

The Preview workflow (`.github/workflows/preview.yml`) deploys `main` to a Worker named
`ember-production` on your workers.dev subdomain after every push, or when run by hand from the
Actions tab. It needs two repository secrets, and skips without them:

- `CLOUDFLARE_API_TOKEN`: a token made from the "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID`: under Account details on the Workers & Pages overview.

Once it's deployed, open the preview's link to set up Ember, which whoever gets there first does.
The first deploy makes the Worker's `SESSION_SECRET` and VAPID key pair, and later ones keep them;
they go up with the deploy, never in its logs.

Repository variables named `EMBER_SETUP_NAME_PLACEHOLDER` and `EMBER_SETUP_EMAIL_PLACEHOLDER`, if
you add them, become the preview's setup form placeholders.

The preview is a private workspace, which its administrator invites people to with the join link.
Its version, under the sign-in page's help contact, is the commit it deployed. After each deploy,
`node apps/worker/scripts/check-deploy.ts <url>` checks, without signing in, that `/api/health`
answers (which needs `SESSION_SECRET`, and the Workspace and a room's Durable Object reading their
storage), that the page loads through the Worker with its headers, that the API asks for sign-in,
and whether Ember is set up yet. The preview's link is on the run's summary and under the
repository's Deployments.

### Resetting a password

Someone who can't sign in gets a new password from `apps/worker/scripts/reset-password.ts`, as
ember-rust's `emberctl reset-password` gives one on its server. The Worker takes recovery requests
only while its `EMBER_RECOVERY_TOKEN` secret is set, and the script sends the same token from your
shell's environment, so set one up just for the reset (add `--name ember-production` to each
`wrangler` command for the preview):

```sh
export EMBER_RECOVERY_TOKEN=$(openssl rand -hex 32)
printf %s "$EMBER_RECOVERY_TOKEN" | pnpm --filter @ember/worker exec wrangler secret put EMBER_RECOVERY_TOKEN
node apps/worker/scripts/reset-password.ts https://<your Worker> ada@example.com
pnpm --filter @ember/worker exec wrangler secret delete EMBER_RECOVERY_TOKEN
```

The script asks for the new password twice without showing it, or reads one line from stdin. All
the person's sessions end, and their open tabs go to sign in. Their role and status stay as they
were, so someone deactivated or banned still can't sign in. Whoever has the token can take over any
account, so delete the secret once you're done; without it, the endpoint answers 404, as any
address the API doesn't have does.

## Status

This is the starter. Working now: first-run setup, which creates the administrator and the rooms
general and random, the join link on general's welcome card, sign-in by email address and password
(10 tries per IP address every 3 minutes) or,
when `EMBER_GUEST_SIGN_IN` allows it, by display name, with a session cookie the Workspace keeps,
sign-out, which closes that browser's sockets, open and private rooms that only their members can
open (made through the API until the New room page lands), live messages with optimistic sends, edit
and delete your own messages, Ember's quick and tray reactions, presence, typing indicators, history
paging, reconnects, a sidebar that loads again whenever a tab reconnects, the Light / Dark / System appearance picker, the web app manifest that lets
browsers install Ember as an app, ember-rust's security headers and HTTPS, and its page for browsers
too old to run Ember. The rail's DMs, Activity, Search and Workspace entries are shown but disabled.

Next, roughly in order: a workspace directory for creating rooms and private rooms, direct messages,
unread state and the Activity filter, starred rooms and room order, rich text and attachments (R2),
search, and Web Push.
