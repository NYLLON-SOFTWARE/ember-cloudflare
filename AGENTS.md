# Ember

Slack-like chat on Cloudflare Workers and Durable Objects. See `README.md` for the layout.

- The design and UX come from `NYLLON-SOFTWARE/ember-rust`. When in doubt about how something
  should look or behave, read it there: `crates/assets/overrides/zz-ember.css` (workspace styles),
  `crates/assets/overrides/basecoat/src/theme.css` (tokens), and `crates/views/templates/`
  (markup). Cite the file when you port something, and say why when deliberately diverging.
- Ember's palette lives in `apps/web/src/index.css` as shadcn/ui tokens. Use the tokens
  (`bg-surface`, `bg-hover`, `text-muted-foreground`, `text-message-ink`, ...) rather than raw colors.
- Add shadcn/ui components with `pnpm dlx shadcn@latest add <name>` from `apps/web`.
- Icons are ember-rust's, exactly. Import them from `apps/web/src/components/icons/` (Ember's line
  icons, Lucide pinned to ember-rust's release, Campfire's SVGs), never from `lucide-react`; its
  README says how to add one. shadcn/ui components arrive with `lucide-react` icons, so swap those.
- Every WebSocket frame is typed in `packages/protocol`. Change the types there first, validate
  anything from a client in `parseClientFrame`, and keep the worker and web app in step.
- Messages are stored through `apps/worker/src/store.ts`, which must work on both Durable Object
  SQLite and D1. Schema changes go in a new file under `apps/worker/migrations/`; the Durable
  Object applies the same SQL. The worker tests run against both backends, so keep them green on both.
- Tests live beside the code (`*.test.ts`), except the worker's, which run inside workerd from
  `apps/worker/test/`. Run `pnpm typecheck && pnpm test && pnpm build` before committing.
- Write code that reads like the surrounding code: small, clearly named functions, and comments
  only where the behavior is non-obvious.
