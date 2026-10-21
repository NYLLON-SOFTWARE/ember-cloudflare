# Ember

Slack-like chat on Cloudflare Workers and Durable Objects. See `README.md` for the layout.

- The design and UX come from `NYLLON-SOFTWARE/ember-rust`. When in doubt about how something
  should look or behave, read it there: `crates/assets/overrides/zz-ember.css` (workspace styles),
  `crates/assets/overrides/basecoat/src/theme.css` (tokens), and `crates/views/templates/`
  (markup). Cite the file when you port something, and say why when deliberately diverging.
- Ember's palette lives in `apps/web/src/index.css` as shadcn/ui tokens. Use the tokens
  (`bg-surface`, `bg-hover`, `text-muted-foreground`, `text-message-ink`, ...) rather than raw colors.
- Add shadcn/ui components with `pnpm dlx shadcn@latest add <name>` from `apps/web`.
- Icons are ember-rust's, exactly, except the rail's navigation icons, which are Iconoir's by the
  project owner's choice. Import them from `apps/web/src/components/icons/` (Ember's line icons,
  Lucide pinned to ember-rust's release, Campfire's SVGs, the rail's Iconoir icons), never from
  `lucide-react`; its README says how to add one. shadcn/ui components arrive with `lucide-react`
  icons, so swap those.
- Every WebSocket frame is typed in `packages/protocol`. Change the types there first, validate
  anything from a client in `parseClientFrame`, and keep the worker and web app in step.
- Data is stored through `apps/worker/src/db.ts`, whose SQL must work on both Durable Object SQLite
  and D1; a write that has to be atomic is one `batch`. Schema changes go in a new file under
  `apps/worker/migrations/`, listed in `MIGRATIONS` in `apps/worker/src/migrations.ts` with the kind
  of object whose tables it changes: wrangler applies every file to D1, and each Durable Object
  applies its own kind's that it's missing when it opens. The search index keeps its FTS5 tables in
  its own storage on either backend, since D1 can't export a database holding a virtual table, so
  its changes go in `apps/worker/search-migrations/`, listed in `SEARCH_MIGRATIONS`. The worker tests
  run against both backends, so keep them green on both.
- Both backends bind at most 100 values a statement, so never bind a list whose length depends on
  the data. Write one statement per query shape, too: SQLite can't use an index through
  `? IS NULL OR id < ?`. `docs/database.md` compares our schema with ember-rust's and lists which of
  its choices to adopt as features land.
- Tests live beside the code (`*.test.ts`), except the worker's, which run inside workerd from
  `apps/worker/test/`. Run `pnpm typecheck && pnpm test && pnpm build` before committing.
- Every feature of ember-rust is in `packages/parity/src/features.ts`, and `PARITY.md` is generated
  from it. Tag tests with the feature they cover (`describe(feature("messages.edit"), ...)`). When
  you port or change a feature, update its status and notes, then run `pnpm parity`.
- `pnpm perf` load-tests the Worker and the web app (`perf/README.md`). When a change touches
  broadcasts, presence, storage queries or the message timeline, run `pnpm perf --quick` before and
  after it and check the two with `pnpm perf compare`.
- `.claude/skills/` holds Cloudflare's, Vercel's and Addy Osmani's agent skills, copied unmodified:
  refresh them with the commands in its README rather than editing them.
  `vercel-react-best-practices` is written for Next.js, so skip its `server-*` rules and SWR advice,
  and use `React.lazy` where it suggests `next/dynamic`.
- Write code that reads like the surrounding code: small, clearly named functions, and comments
  only where the behavior is non-obvious.
