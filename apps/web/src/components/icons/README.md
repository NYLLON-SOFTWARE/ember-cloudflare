# Icons

ember-cloudflare draws exactly the icons ember-rust draws, from the same sources. Import them from
this folder, never from `lucide-react` directly: `icons.test.tsx` fails `pnpm test`, and so CI, if any
other file does, and it checks every Lucide icon here against ember-rust's catalog.

| Module | What it holds | Where ember-rust gets it |
|---|---|---|
| `ember.tsx` | Ember's own line icons (24px grid, 1.7 stroke, `currentColor`): the rail, the mobile menu, close buttons, the sign-in form | `crates/views/templates/components/icons.html`, drawn with `{% call icons::icon("name") %}` |
| `lucide.ts` | Lucide, pinned to 1.53.0: message actions and the appearance menu | `h::lucide_icon("name")`, from the generated `crates/assets/overrides/lucide/catalog.json` (lucide-static 1.53.0) |
| `campfire.tsx`, `campfire/*.svg` | Campfire's filled icons, drawn as black `<img>`s and inverted where the background is dark | `ctx.asset("name.svg")` or `h::image_tag(ctx, "name.svg", …)`, served from its `reference/` submodule: basecamp/once-campfire `app/assets/images/` at `90b3300` |

The brand images live in `apps/web/public`, with the icons the web app manifest lists.
`logos/app-icon.png` and `logos/app-icon-192.png` are ember-rust's `crates/assets/overrides/logos/`
icons, byte for byte: the home-screen icon and the installed app's. `shortcuts/add.svg` and
`shortcuts/person.svg` are Campfire's, for the installed app's New chat room and My profile
shortcuts. The favicon,
`logos/app-icon-48.png`, is the same image scaled from 512px down to 48px: browsers fetch the favicon
while the page loads, and in Lighthouse the 121 KB original delayed a room's largest paint by about
390 ms on mobile and 80 ms on desktop.
`ember-icon.png` is ember-rust's `crates/assets/overrides/ember-icon.png` (the flame on the rail and the
sign-in card) scaled from 1254px down to 192px, so the page doesn't load 595 KB for a 44px mark.

## Adding an icon

Find the element you're porting in ember-rust's templates and see how it draws its icon:

- **`icons::icon("name")`**: copy its shapes from `icons.html` into `ember.tsx` verbatim.
- **`h::lucide_icon("name")`**: add the icon's PascalCase name to the export in `lucide.ts` (Lucide's
  own name, not an alias: `face-slightly-smiling-plus` is `FaceSlightlySmilingPlus`), and its markup
  from `catalog.json` to the catalog in `icons.test.tsx`. Keep `lucide-react` on 1.53.0 until
  ember-rust moves its pin.
- **`ctx.asset("name.svg")`**: copy the file byte for byte from once-campfire's `app/assets/images/`
  into `campfire/` (check `crates/assets/overrides/` first, since a file there replaces Campfire's),
  then export it from `campfire.tsx`. Choose its tone from how ember-rust colors it
  (`zz-ember.css`, the `--mb-icon-invert` rules):
  - `colorize--black`, or a plain `<img>` in a `.btn`: `tone="black"` (the default).
  - `colorize--white`, or an `<img>` in a `btn--reversed` button: `tone="reversed"`.
  - An `<img>` in a `btn--negative` button or a flash: `tone="white"`, white in both modes.

Size icons as `zz-ember.css` sizes that element (the rail's are 22px, sidebar headings 15px, message
actions 16px, composer buttons 18px). Adding a shadcn/ui component brings `lucide-react` imports with
it, so swap those for icons from here.
