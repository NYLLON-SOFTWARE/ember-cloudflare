# Icons

ember-cloudflare draws exactly the icons ember-rust draws, from the same sources. Import them from
this folder, never from `lucide-react` directly: `icons.test.tsx` fails `pnpm test`, and so CI, if any
other file does, and it checks every Lucide icon here against ember-rust's catalog, copied into
`lucide/`.

| Module | What it holds | Where ember-rust gets it |
|---|---|---|
| `ember.tsx` | Ember's own line icons (24px grid, 1.7 stroke, `currentColor`): the rail, the mobile menu, close buttons, the sign-in form, the welcome card's link, and the room icon picker's and unsaved changes dialog's drawings (1.75 stroke) | `crates/views/templates/components/icons.html`, drawn with `{% call icons::icon("name") %}`; the others are inline in `rooms/show/_invitation.html`, `rooms/layouts/_icon_picker.html` and `components/unsaved_changes.html` |
| `lucide.ts` | Lucide, pinned to 1.53.0: message actions, the appearance menu, and the star in a room's header, which is filled while the room is starred | `h::lucide_icon("name")`, from the generated `crates/assets/overrides/lucide/catalog.json` (lucide-static 1.53.0); the star is `h::channel_icon(Some("star"))`, the catalog's drawing written into the page, so this draws it as an SVG rather than `room-icon.tsx`'s mask, which can't be filled |
| `lucide/catalog.json`, `lucide/LICENSE.txt` | Every icon a room can have: ember-rust's catalog of 1,869 Lucide icons (`{name, label, svg}`, 991 KB), with Lucide's license. `ROOM_ICON_NAMES` in `@ember/protocol` lists their names. `vite.config.ts` writes each icon to a file of its own, `/lucide/icons/<name>.svg`, and the room icon picker loads the whole catalog when it first opens | `crates/assets/overrides/lucide/`, generated from lucide-static 1.53.0 and copied byte for byte |
| `room-icon.tsx` | A room's icon, from its own file, as a mask in the color of the text around it, or `#` for the default | `h::channel_icon`, `crates/views/src/helpers/icons.rs`, which writes the catalog's SVG into the page |
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
`browsers/` holds Campfire's browser logos, byte for byte, for the Worker's "Upgrade to a supported web
browser" page. They're static files rather than icons here because that page is plain HTML from the
Worker, which old browsers can read without the app. Whatever goes in `public` is also left out of
`run_worker_first` in `apps/worker/wrangler.jsonc`, as these are, so it's served without the Worker.

## Adding an icon

Find the element you're porting in ember-rust's templates and see how it draws its icon:

- **`icons::icon("name")`**, or an `<svg>` written into the template: copy its shapes from `icons.html`, or
  the template, into `ember.tsx` verbatim.
- **`h::lucide_icon("name")`**: add the icon's PascalCase name to the export in `lucide.ts` (Lucide's
  own name, not an alias: `face-slightly-smiling-plus` is `FaceSlightlySmilingPlus`), and
  `icons.test.tsx` compares its drawing with the catalog's. Keep `lucide-react` on 1.53.0 until
  ember-rust moves its pin.
- **`ctx.asset("name.svg")`**: copy the file byte for byte from once-campfire's `app/assets/images/`
  into `campfire/` (check `crates/assets/overrides/` first, since a file there replaces Campfire's),
  then export it from `campfire.tsx`. Choose its tone from how ember-rust colors it
  (`zz-ember.css`, the `--mb-icon-invert` rules):
  - `colorize--black`, or a plain `<img>` in a `.btn`: `tone="black"` (the default).
  - `colorize--white`, or an `<img>` in a `btn--reversed` button: `tone="reversed"`.
  - An `<img>` in a `btn--negative` button or a flash: `tone="white"`, white in both modes.
  - `color-icon`, which keeps a colored icon such as the translation buttons' globe out of those
    rules: `tone="color"`, in its own colors in both modes.

Size icons as `zz-ember.css` sizes that element (the rail's are 22px, sidebar headings 15px, message
actions 16px, composer buttons 18px). Adding a shadcn/ui component brings `lucide-react` imports with
it, so swap those for icons from here.

## Moving the Lucide pin

When ember-rust moves `lucide-static` (`crates/assets/overrides/basecoat/package.json`), copy its
`crates/assets/overrides/lucide/catalog.json` and `LICENSE.txt` into `lucide/` byte for byte, put their
SHA-256 hashes and ember-rust's commit in `catalog.test.ts`, and move `lucide-react` to the same
version. Then `pnpm --filter @ember/web exec vitest run catalog --update` rewrites the room icons'
names in `packages/protocol/src/room-icons.ts`.
