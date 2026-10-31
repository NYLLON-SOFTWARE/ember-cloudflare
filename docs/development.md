# Developing Ember

Ember is a React app served by a Worker, with one Durable Object per room holding its WebSockets,
presence, typing state and messages. This is how its code is laid out, how to run it on your machine,
and how it's tested. The [self-hosting guide](self-hosting.md) covers deploying it, and
[`AGENTS.md`](../AGENTS.md) the conventions changes follow.

## Layout

| Path | Package | What |
|---|---|---|
| `apps/web` | `@ember/web` | React + Vite + Tailwind CSS v4 + shadcn/ui. The workspace UI. |
| `apps/worker` | `@ember/worker` | The Worker (`/api/*`, `/up`, the app's pages with Campfire's headers and error pages, the web app manifest, static assets) and the `ChatRoom`, `Workspace`, `SearchIndex`, `PasswordHasher` and `Unfurler` Durable Objects. |
| `packages/protocol` | `@ember/protocol` | WebSocket frame types and validation shared by both, and the addresses of the app's pages. |
| `packages/richtext` | `@ember/richtext` | Message bodies as Campfire's Action Text reads them: sanitizing, plain text, mentions and emoji-only bodies, golden-tested against a corpus of Campfire's Rails outputs. |

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
pnpm build          # once: wrangler dev serves the app's files from apps/web/dist
pnpm dev            # wrangler dev on :8787 and Vite on :5173 (proxies /api)
```

`pnpm dev` sets a `SESSION_SECRET` for your machine and lets anyone sign in with just a name. The
optional settings, such as push notifications' keys, go in a `.dev.vars` beside `wrangler.jsonc`:
`.dev.vars.example` lists them.

Open http://localhost:5173 and set up Ember: the first visitor creates the workspace's administrator
and its rooms, general and random. Then open a second browser, pick a name, and chat with yourself.
On localhost setup is open to whoever's there; a deployed Worker takes the setup link its deploy
prints ([Deploying](self-hosting.md#deploying)).

Or, before setting it up, run `pnpm seed` to have a made-up team set it up and fill its rooms and DMs
with conversations that use everything a message can: threads, quotes, mentions, reactions, pictures,
files, link previews and bots. It prints how to sign in as each of them (`apps/worker/scripts/seed.ts` says more).

```sh
pnpm typecheck
pnpm test           # unit tests; worker tests run in workerd, once per storage backend
pnpm build
```

## Storage

Where messages live, each room's Durable Object SQLite or one D1 database, is a deploy's choice:
[Storage](self-hosting.md#storage-durable-object-sqlite-or-d1) in the self-hosting guide says how each
works, and [`docs/database.md`](database.md) compares the schema with Campfire's.

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

The features suite (`e2e/tests/features/`) has a spec per area of the app. Each test gets rooms of
its own, and `members.signIn` opens a browser per person, so tests can chat, react and watch
each other type without seeing another test's messages.

The mobile suite (`e2e/tests/mobile/`) emulates seven phones, from a 320px iPhone SE to an iPhone
17 Pro Max on its side, with their notches, home indicators and on-screen keyboards. On every
screen it checks that nothing overflows sideways or sits under the notch, that every control is a
44px tap target, and that text fields are 16px so iOS doesn't zoom in on focus. Where a browser is
already installed, point Playwright at it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

The screenshots suite (`e2e/tests/screenshots/`) makes the screenshots the web app manifest lists,
which an install prompt shows: a few people chatting, on a phone. `pnpm screenshots` saves them over
`apps/web/public/screenshots/`, and every other run with the test's results, so they keep working.

## Performance

`pnpm perf` load-tests the Worker under `wrangler dev` on both storage backends (latency,
throughput, fan-out, room size, history paging, search) and measures how the web app loads and renders a
busy room. `perf/README.md` explains the scenarios and how to compare two runs; the numbers the
suite started with are in `perf/baseline/report.md`.
