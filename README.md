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
| `apps/worker` | `@ember/worker` | The Worker (`/api/*`, static assets) and the `ChatRoom` Durable Object. |
| `packages/protocol` | `@ember/protocol` | WebSocket frame types and validation shared by both. |

```
browser ──HTTP──▶ Worker ──▶ static assets (apps/web/dist)
   │                │
   └──WebSocket─────┴──▶ ChatRoom Durable Object (one per room, by name)
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

Open http://localhost:5173, pick a name, and open a second browser to chat with yourself.

```sh
pnpm typecheck
pnpm test           # protocol + web unit tests; worker tests run in workerd, once per storage backend
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
pnpm test:mobile    # just the phones
```

The mobile suite (`e2e/tests/mobile/`) emulates seven phones, from a 320px iPhone SE to an iPhone
17 Pro Max on its side, with their notches, home indicators and on-screen keyboards. On every
screen it checks that nothing overflows sideways or sits under the notch, that every control is a
44px tap target, and that text fields are 16px so iOS doesn't zoom in on focus. Where a browser is
already installed, point Playwright at it with `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## Performance

`pnpm perf` load-tests the Worker under `wrangler dev` on both storage backends (latency,
throughput, fan-out, room size, history paging) and measures how the web app loads and renders a
busy room. `perf/README.md` explains the scenarios and how to compare two runs; the numbers the
suite started with are in `perf/baseline/report.md`.

## Storage: Durable Object SQLite or D1

`STORAGE_BACKEND` in `apps/worker/wrangler.jsonc` picks where messages live.

- **`do-sqlite`** (default): each room's Durable Object keeps its messages in its own SQLite
  storage. Nothing to provision, and reads and writes never leave the object.
- **`d1`**: messages go to one shared D1 database, which makes cross-room queries (search,
  activity, exports) straightforward. Create the database with `wrangler d1 create ember`,
  uncomment the `d1_databases` block, set `STORAGE_BACKEND` to `"d1"`, and apply
  `apps/worker/migrations/` with `pnpm --filter @ember/worker d1:migrate:local` (or `--remote`).

Both use the same schema (`apps/worker/migrations/0001_messages.sql`) and the same queries
(`apps/worker/src/store.ts`); only the driver differs.

## Deploying

```sh
pnpm --filter @ember/worker exec wrangler secret put SESSION_SECRET
pnpm deploy
```

## Status

This is the starter. Working now: sign-in by display name, open rooms from `DEFAULT_ROOMS`, live
messages with optimistic sends, edit and delete your own messages, Ember's quick and tray
reactions, presence, typing indicators, history paging, reconnects, and the Light / Dark / System
appearance picker. The rail's DMs, Activity, Search and Workspace entries are shown but disabled.

Next, roughly in order: real accounts and sessions (Workers + D1), a workspace directory for
creating rooms and private rooms, direct messages, unread state and the Activity filter, starred
rooms and room order, rich text and attachments (R2), search, and Web Push.
