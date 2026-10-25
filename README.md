# Ember

A Slack-like real-time chat app that runs entirely on Cloudflare: a React app served by a Worker,
with one Durable Object per room holding its WebSockets, presence, typing state and messages.

The design and UX are ported from [ember-rust](https://github.com/NYLLON-SOFTWARE/ember-rust),
NYLLON's Rust fork of Campfire. That repository is the reference for how things should look and
behave; this one rebuilds it on Workers and Durable Objects.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/NYLLON-SOFTWARE/ember-cloudflare)

The button copies this repository to your GitHub or GitLab account and deploys it to your
Cloudflare account, as [Deploying](#deploying) describes.

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
pnpm dev            # wrangler dev on :8787 and Vite on :5173 (proxies /api)
```

`pnpm dev` sets a `SESSION_SECRET` for your machine and lets anyone sign in with just a name. The
optional settings, such as push notifications' keys, go in a `.dev.vars` beside `wrangler.jsonc`:
`.dev.vars.example` lists them.

Open http://localhost:5173 and set up Ember: the first visitor creates the workspace's administrator
and its rooms, general and random. Then open a second browser, pick a name, and chat with yourself.
On localhost setup is open to whoever's there; a deployed Worker takes the setup link its deploy
prints ([Deploying](#deploying)).

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

`STORAGE_BACKEND` in `wrangler.jsonc` picks where messages live.

- **`do-sqlite`** (default): each room's Durable Object keeps its messages in its own SQLite
  storage. Nothing to provision, and reads and writes never leave the object.
- **`d1`**: messages go to one shared D1 database, which makes cross-room queries (activity,
  exports) straightforward. Create the database with `pnpm exec wrangler d1 create ember`,
  uncomment the `d1_databases` block, set `STORAGE_BACKEND` to `"d1"`, and apply
  `apps/worker/migrations/` with `pnpm --filter @ember/worker d1:migrate:local` (or `--remote`).

Both use the same schema (`apps/worker/migrations/`) and the same queries
(`apps/worker/src/store.ts`); only the driver (`apps/worker/src/db.ts`) differs. The Workspace
object's tables follow the same setting. The search index's don't: it keeps every room's messages in
one FTS5 table in the `SearchIndex` object's own storage, since D1 can't export a database that holds
one. [`docs/database.md`](docs/database.md) compares them with ember-rust's database.

## Deploying

The Deploy to Cloudflare button at the top asks you to name the repository, the Worker and the R2
bucket for files (turn R2 on for your account first), then Cloudflare's Workers Builds builds and
deploys it, and again after every push to the copy. There are no secrets to fill in. To deploy from
your machine instead, after `pnpm exec wrangler login`:

```sh
pnpm build
pnpm run deploy        # not `pnpm deploy`, which is pnpm's own command
```

Either way, `pnpm run deploy` (`apps/worker/scripts/deploy.ts`) makes the Worker's `SESSION_SECRET`
and a VAPID key pair for push notifications on its first deploy, and later deploys keep them, since
a new secret would sign everyone out and a new pair would end every push subscription. They go up
with the code and never appear in the deploy's output.

The first deploy also makes the Worker's setup token, `EMBER_SETUP_TOKEN`, and ends by printing the
setup link that carries it, `https://<your Worker>/first_run#token=<the token>`: in your terminal,
or in the build's log in the Cloudflare dashboard after Deploy to Cloudflare. Open it to set up
Ember. Only that link opens the form, so nobody who merely finds the address can make themselves
the administrator, as ember-rust's installer-printed setup link makes sure, and once Ember is set up
the link is spent: setup closes for good, as in Campfire. The token rides in the link's fragment,
which no request or log sees. `/first_run` opened without it says all this, and if the link is lost,
make a new token, give it to the Worker, and open the link with that one:

```sh
openssl rand -hex 32                              # the new token: keep it
pnpm exec wrangler secret put EMBER_SETUP_TOKEN   # asks for it; add --name <worker> for a Worker not named in wrangler.jsonc
```

On localhost, where `wrangler dev` serves, setup is open to whoever's there unless `.dev.vars`
sets a token.

The setup form suggests Kevin Rose and kevin@kevinrose.com for the administrator, where ember-rust's
suggests Jane Cooper. To suggest your own, set the Worker's `EMBER_SETUP_NAME_PLACEHOLDER` and
`EMBER_SETUP_EMAIL_PLACEHOLDER` variables, in `vars` in `wrangler.jsonc` for instance.

The administrator then signs in at `/session/new` with the email address and password they set up
with, and invites people with the join link on general's welcome card.

Ember insists on HTTPS, as ember-rust does: plain HTTP is redirected to the same address over HTTPS,
and every answer from the Worker carries HSTS, except on `localhost` and loopback addresses, where
`wrangler dev` serves. Unlike ember-rust's, it holds only the address it's given at to HTTPS, not the
names under it, which would be every name on a domain whose apex is Ember's custom domain. To serve
plain HTTP anywhere else, such as `wrangler dev --ip 0.0.0.0` for a phone on your network, set the
`DISABLE_SSL` variable to any value. `/up` answers 200 for uptime checks, as Rails' does, without
touching storage.

### A custom domain

Ember answers at its workers.dev address until an administrator gives it one of your own, under
Custom domain in Workspace settings, which walks them through it:

1. In the Cloudflare dashboard, add the address, `chat.example.com` say, as a Custom Domain of Ember's
   Worker: Workers & Pages, the Worker, Domains, Add Domain. At the workers.dev address the step names
   the Worker and links straight to its Domains tab. Its domain must be on Cloudflare, in the account
   that runs the Worker, unless you [keep its DNS elsewhere](#when-the-domains-dns-is-elsewhere);
   Cloudflare makes the DNS record and the certificate. Ember holds no Cloudflare token to do this
   itself, since a token that can add a domain to the Worker can also deploy new code to it.
2. Check DNS, which asks the domain from the Worker for a one-time probe only this Ember answers, and
   says whether it reaches Ember, something else answers there, or nothing does yet.
3. Open `https://chat.example.com/account/edit`, sign in, and choose Use this address. Ember takes only
   the address the page is open at, so it can't be sent to one that doesn't reach it.

From then on, a page opened at any other address moves to the same page at the new one, and the bot
API's links name it. Everyone signs in once more there, since a session belongs to its address, and
turns notifications on again, which replaces their browser's subscription at the old address. Bots
and webhooks go on posting to the addresses they were given. Workspace settings stay wherever they're
opened, so if the domain ever stops reaching Ember, open them at the workers.dev address and choose
Stop using it. Deploys leave the domain alone as long as `wrangler.jsonc` lists no `routes`.

#### When the domain's DNS is elsewhere

Cloudflare gives a Worker a Custom Domain only on a domain whose DNS it runs: Add Domain with any
other offers to move the domain's DNS to Cloudflare, which is free and copies its records. To leave
the DNS where it is, give Ember the address through Cloudflare for SaaS instead. That takes another
domain already on Cloudflare in the account that runs Ember, `example.net` say, and a payment
method, though the first 100 addresses are free. In the Cloudflare dashboard, on example.net:

1. Under SSL/TLS, Custom Hostnames, enable Cloudflare for SaaS.
2. Under DNS, Records, add a proxied `AAAA` record, `ember-saas` say, for `100::`, an address that
   goes nowhere, and make `ember-saas.example.net` the Fallback Origin under Custom Hostnames.
3. Under Workers Routes, route `chat.example.com/*` to Ember's Worker, and
   `chat.example.com/.well-known/*` to no Worker, so that Cloudflare itself answers the certificate
   authority when it issues and renews the address's certificate. A route for `*/*`, as Cloudflare's
   guide suggests, would send all of example.net to Ember.
4. Under Custom Hostnames, add `chat.example.com` with HTTP validation.

Then at chat.example.com's DNS provider add `chat.example.com CNAME ember-saas.example.net`. That
record is why the address must be a name under the domain, such as chat.example.com: example.com
itself can't be a CNAME. Once Custom Hostnames shows the address and its certificate active, carry
on from Check DNS.

### Who can join

New people join with the join link until an administrator changes how under Who can join, in
Workspace settings' Membership, where each way has a switch:

- Open, off until it's turned on, lets anyone create an account at `https://<Ember's address>/join`,
  which the sign-in page links to as Create an account. Nobody checks that an email address is the
  owner's. Until Ember has Turnstile's keys, below, each network can sign up 5 people an hour, and
  once 50 people have joined in an hour, however they joined, signing up waits, so a flood can't use
  up the rows Workers Free writes in a day.
- Join link, on until it's turned off, lets in anyone with the link. Off, the link sends people to
  sign in, and on again, it's the same link.
- Email domain, off until it's turned on, lets in people with an email address at the domains an
  administrator lists, such as their company's. They ask for a link at
  `https://<Ember's address>/join/email`, which the sign-in page offers as "Have an address at
  example.com? Join with it", and Ember emails them one that joins with that address, once, within
  an hour, so it can't be turned on until Ember sends email, below. Ember emails an address at most
  3 links an hour, whoever asks, so nobody can fill someone's inbox with them, counting only the
  emails the provider takes, and until Ember has Turnstile's keys, each network can ask for 10 links
  an hour. Each link is an email, so the provider's limits apply.
- Memberful, below, lets in the members of a Memberful site, who sign in with their Memberful
  accounts while everyone else keeps a password. Its Members only switch keeps signing in to them
  and administrators.

While Open is on, Join link, Email domain and Memberful are set aside, keeping their settings, and
while Memberful is members only, Open, Join link and Email domain are, so Open and Members only can't
both be on. With all four off, only the people administrators invite by email, below, can join.

To have open sign-up, and Email domain's page, check that whoever uses them is a person, make a
[Turnstile](https://developers.cloudflare.com/turnstile/) widget for Ember's hostname in Managed mode,
under Turnstile in the Cloudflare dashboard or with wrangler, which prints its site key and secret key,
and give the Worker both as secrets:

```sh
pnpm exec wrangler turnstile widget create Ember --domain chat.example.com --mode managed
pnpm exec wrangler secret put TURNSTILE_SITE_KEY     # add --name <worker> for a Worker not named in wrangler.jsonc
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
```

The sign-up page and Email domain's then show Turnstile's check, and the Worker asks Turnstile about
each form before it makes the account or emails the link, in place of the limits on a network, which
a room full of people on one network, or a launch, would soon reach. `pnpm run deploy` uploads the
two when its environment has them, as it does Memberful's keys, so the Preview workflow passes
repository secrets of the same names through.

### Memberful sign-in

The members of a [Memberful](https://memberful.com) site can join and sign in with their Memberful
accounts instead of passwords. It's off until an administrator turns it on under Memberful in
Workspace settings, which walks them through it:

1. In Memberful, under Settings, Custom applications, add an app with Include OAuth tokens with
   this application checked, choose Server-side, and give it the OAuth redirect URL
   `https://<Ember's address>/auth/memberful/callback`. Leave Memberful's automatic sign-in off,
   since it skips the check that ties a sign-in to the browser that started it.
2. Give the Worker the app's keys as secrets: `MEMBERFUL_URL`, the site's address, such as
   `https://example.memberful.com`, and the app's OAuth identifier and client secret as
   `MEMBERFUL_CLIENT_ID` and `MEMBERFUL_CLIENT_SECRET`. Each command asks for its value:

   ```sh
   pnpm exec wrangler secret put MEMBERFUL_URL      # add --name <worker> for a Worker not named in wrangler.jsonc
   pnpm exec wrangler secret put MEMBERFUL_CLIENT_ID
   pnpm exec wrangler secret put MEMBERFUL_CLIENT_SECRET
   ```

   Or add them under the Worker's Settings, Variables and Secrets in the Cloudflare dashboard, as the
   type Secret, since a deploy takes away plain text ones. `pnpm run deploy` uploads them too when its
   environment has them, so the Preview workflow passes repository secrets of the same names through.
3. So that a member whose membership lapses is signed out, not only kept from signing in again, add
   a webhook in Memberful under Settings, Webhooks that sends the member, subscription and order
   events to `https://<Ember's address>/webhooks/memberful`, and give the Worker the webhook's secret
   key and the app's API key, as the step above does the others:

   ```sh
   pnpm exec wrangler secret put MEMBERFUL_WEBHOOK_SECRET
   pnpm exec wrangler secret put MEMBERFUL_API_KEY
   ```
4. Turn on Memberful in Workspace settings.

While it's on, the sign-in page offers Member? Sign in with Memberful under its form. Someone with an
active subscription, or the all access pass, signs in as the person their Memberful account is
linked to, or else joins as a new member, in every open room, and everyone else joins and signs in
as before. Accounts are linked by the Memberful site and the member's id there, never by email
address, since Memberful lets anyone register an address without proving it's theirs: someone new
whose Memberful email address someone here has already is turned away, and asked to sign in with
their password. The site is `MEMBERFUL_URL`'s address, so keep it once people have signed in: at
another address, even the same site's, every member would be someone new. Turning Memberful off
stops anyone new joining with it, but whoever signed in with it has no password, so they keep
signing in with it, and the sign-in page keeps offering it, while the Worker has the keys.

Members only, under Memberful, keeps Ember to the site's members: the sign-in page offers Sign in
with Memberful in place of its form, Open, the join link and signing in with just a name are off,
and only administrators and the people they invite sign in with a password, who need no membership.
Sessions people have go on, and turning it off brings the other ways and passwords back.

While Memberful is members only, someone with an account from before connects their Memberful
account to it with their password: from the Memberful section of their profile, or as they sign in
with their password, which asks them to connect one until they have. Memberful sends them back
signed in as themselves, and from then on they sign in with Memberful, and their membership counts
as anyone's. A connection is good for one try within ten minutes, and a new password, theirs or a
reset, forgets the ones the old one started. Administrators, and the people they invite, can connect
one too, and sign in either way.

A member whose membership lapses can't sign in with Memberful again. With the webhook, they're suspended too: their
sessions end, their sockets close and their browsers' push subscriptions are forgotten, but their
rooms, private ones too, messages and role stay, and they're back as they were once it's renewed and
they sign in. Making an open room private leaves them out of it, as it does anyone not chosen. A
webhook only tells Ember whom to ask about: Memberful sends them in no particular order, so the
Workspace asks Memberful's API what that member's membership is now, and asks about everyone linked
once a day too, in case one never came. Administrators, and the people they invite, who need no
membership, are never suspended. Administrators see suspended members dimmed in Workspace settings,
where they can remove them, and everyone else sees them as removed. All of this goes on whether
Memberful is on or not, since its members keep signing in with it once it's off.

### Sending email

Ember sends email with [Cloudflare Email Service](https://developers.cloudflare.com/email-service/),
which wrangler.jsonc binds as `EMAIL`, or with [Resend](https://resend.com) once the Worker has a
`RESEND_API_KEY`. Either way it sends from the address an administrator gives under Email, in
Workspace settings' Membership, which walks them through setting it up and sends them a test email.

With Cloudflare Email Service, in beta since April 2026:

1. Put the Cloudflare account that runs Ember on the Workers Paid plan, which includes 3,000 emails a
   month. On Workers Free it sends only to the account's own verified addresses.
2. In the Cloudflare dashboard, under Email Service, Email Sending, choose Onboard Domain and pick a
   domain on Cloudflare DNS, such as the one Ember's custom domain is on. Cloudflare adds the records
   sending takes.
3. Under Email in Membership, give a From address on that domain, such as `Ember <ember@example.com>`,
   save it, and choose Send me a test email.

With Resend, which sends 3,000 emails a month, at most 100 a day, for free, on Workers Free too: add
the domain under Domains in Resend until it's verified, make an API key that can send, and give it to
the Worker, then give the From address and send the test email as above:

```sh
pnpm exec wrangler secret put RESEND_API_KEY     # add --name <worker> for a Worker not named in wrangler.jsonc
```

With a key, Ember sends with Resend rather than Cloudflare. `pnpm run deploy` uploads it when its
environment has it, so the Preview workflow passes a repository secret of the same name through.
When the provider refuses the test email, Membership says why, such as a domain that isn't onboarded
or a day's quota used up. `wrangler dev` sends nothing with Cloudflare's binding: it logs each email
and saves it to a file.

### Inviting people by email

Under Invite by email, in Workspace settings' Membership, an administrator gives the email addresses
of the people to invite, and Ember emails each a link that joins with that address, once, within 7
days, whichever ways to join are on, Members only included. Until Ember can send email, the card
makes the links for the administrator to copy and send. The invitations nobody has accepted are
listed there, each to send again, which replaces its link, or revoke, and joining with an invited
address, however someone joins, spends its invitation. A link keeps its secret in the address's
fragment, which never reaches a server, and Ember keeps only its digest. Each invitation is an email,
so the provider's limits apply, such as Resend's 100 a day for free.

### Push notifications

Push notifications need a VAPID key pair, which the first deploy makes. `pnpm vapid:keys` prints a
new one as the Worker's two settings, for `.dev.vars` or to replace a deployment's:

```sh
pnpm vapid:keys
pnpm exec wrangler secret put VAPID_PUBLIC_KEY
pnpm exec wrangler secret put VAPID_PRIVATE_KEY
```

Without them push is off, and `/api/health` tells an administrator why. Keep the pair once people
use it: browsers subscribe with its public key, so a new pair leaves everyone to turn notifications
on again. A pair from ember-rust's `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` works as it is.

A new message is pushed from its room's Durable Object as the room tells the Workspace of it, to the
subscriptions of the members who aren't viewing the room and want to hear of it: each person keeps
one for each browser they turned notifications on in, which saves it again each time Ember opens
there, and only the 10 saved most recently. Push services may contact whoever `VAPID_SUBJECT` names,
a `mailto:` or `https:` address, about your pushes; without it they see this project's address. Each
push is an outgoing request, of which the Workers Free plan allows 50 per invocation, so there the
pushes past that, for a message with more subscribers or a run of messages sent together, fail and
are logged; the Paid plan allows 10,000.

### Files

The files people upload go to an R2 bucket, bound as `FILES` in `wrangler.jsonc` and
named `ember`. Turn R2 on for your Cloudflare account, then deploy: Wrangler binds the account's
bucket of that name, and creates it if there's none and its token may, or make it yourself first
with `pnpm exec wrangler r2 bucket create ember`. Change `bucket_name` to use
another. `wrangler dev` keeps files on your machine. Without the binding Ember keeps no files, and
`/api/health` tells an administrator so.

A file goes up in parts of 10 MiB, since a Worker takes at most 100 MB a request, and R2 puts them
back together. R2 deletes the parts of an upload nobody finishes after a week.

### A preview from GitHub Actions

The Preview workflow (`.github/workflows/preview.yml`) deploys `main` to a Worker named
`ember-production` on your workers.dev subdomain after every push, or when run by hand from the
Actions tab. It needs two repository secrets, and skips without them:

- `CLOUDFLARE_API_TOKEN`: a token made from the "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID`: under Account details on the Workers & Pages overview.

The first deploy makes the Worker's `SESSION_SECRET` and VAPID key pair, and later ones keep them;
they go up with the deploy, never in its logs. A public repository's Actions logs are public too, so
the workflow prints no setup link and makes no setup token: the Worker takes its token from an
`EMBER_SETUP_TOKEN` repository secret, if you add one (`openssl rand -hex 32`) before the first
deploy, and the run's log then says to open `<the preview>/first_run#token=<your token>` to set
Ember up. Without the secret, the deploy check says nobody can set the preview up until you deploy
it from a terminal with `pnpm run deploy --name ember-production`, which makes a token and prints
the link, or make one with `openssl rand -hex 32` and give it to the preview with
`wrangler secret put EMBER_SETUP_TOKEN --name ember-production`, which asks for it.

Repository variables named `EMBER_SETUP_NAME_PLACEHOLDER` and `EMBER_SETUP_EMAIL_PLACEHOLDER`, if
you add them, become the preview's setup form placeholders.

The preview is a private workspace, which its administrator invites people to with the join link.
Its version, under the sign-in page's card, is the commit it deployed. After each deploy,
`node apps/worker/scripts/check-deploy.ts <url>` checks, without signing in, that `/api/health`
answers (which needs `SESSION_SECRET`, and the Workspace and a room's Durable Object reading their
storage), that the page loads through the Worker with its headers, that the API asks for sign-in,
and whether Ember is set up yet, or waits for its setup link. `/api/health` tells strangers only
whether Ember is up; with the Worker's `EMBER_RECOVERY_TOKEN` in its environment, the check hears
which storage it uses too, and why when it's down. It sends the token only to an `https://` address,
or an `http://` one on this machine, and follows no redirect with it. The preview's link is on the
run's summary and under the repository's Deployments.

### Resetting a password

Someone who can't sign in gets a new password from `apps/worker/scripts/reset-password.ts`, as
ember-rust's `emberctl reset-password` gives one on its server. The Worker takes recovery requests
only while its `EMBER_RECOVERY_TOKEN` secret is set, and the script sends the same token from your
shell's environment, so set one up just for the reset (add `--name ember-production` to each
`wrangler` command for the preview):

```sh
export EMBER_RECOVERY_TOKEN=$(openssl rand -hex 32)
printf %s "$EMBER_RECOVERY_TOKEN" | pnpm exec wrangler secret put EMBER_RECOVERY_TOKEN
node apps/worker/scripts/reset-password.ts https://<your Worker> ada@example.com
pnpm exec wrangler secret delete EMBER_RECOVERY_TOKEN
```

The script asks for the new password twice without showing it, or reads one line from stdin. All
the person's sessions end, with the sign-in links they showed, and their open tabs go to sign in.
Their browsers get no pushes until they sign in again. Their role and status stay as they
were, so someone deactivated or banned still can't sign in. Whoever has the token can take over any
account, so delete the secret once you're done; without it, the endpoint answers 404, as any
address the API doesn't have does.

### Security notes

What a self-hoster should know, beyond keeping the setup link to themselves:

- Every answer carries a `Content-Security-Policy` beside Rails' headers: scripts only from your
  Worker, images from any HTTPS site, since link previews show their page's image, and no page of
  Ember's in a frame elsewhere. When the policy gets in the way of something in a browser, the
  browser reports it to `/csp-report` and the Worker logs it, so look there if a page misbehaves.
- Link previews and bot cards show images from other sites, which load without a referrer: a site
  sees the reader's IP address, but not which Ember shows its image.
- An administrator can make a sign-in link for anyone, administrators included, which signs in as
  that person for 4 hours, more than once, while the session that showed it is still signed in as an
  administrator. Your own link works only while the session that showed it does, so signing out, a
  password reset, or a new password saved in another session ends it. Its id travels in the
  address's fragment, which no log sees.
- A file's address is signed and never expires: whoever has it can open the file until its message
  is deleted, as with Active Storage's links.
- A bot's webhook payload carries the bot's key, so point bots only at servers you trust. Webhooks
  go only to https, or to http on localhost, so nobody on the way reads the key; a bot saved with an
  http URL elsewhere before gets no deliveries until its URL is changed, and the Worker's log says
  why.
- Workers Logs record each request's address, which for Campfire's bot API and the Slack-compatible
  webhooks holds the bot's key and for the join link its code; Reset key and Regenerate join link are
  the remedies if a log is shared, and
  `"logs": { "invocation_logs": false }` under `observability` in `wrangler.jsonc` drops the
  per-request record.
- A new password takes at least 8 characters, at setup, on joining, in a profile or in a reset,
  though a shorter one set before keeps working. Passwords are kept as scrypt digests at OWASP's
  cost, which takes about a quarter of a second of CPU in a Durable Object of its own; digests from
  before scrypt are replaced as their passwords sign in.
- A session lasts until it goes 400 days unused. Changing your email address or password takes
  your current password, so holding someone's session isn't enough to take their account, and a new
  password ends your other sessions and forgets their browsers' push subscriptions. A password reset,
  deactivation or ban ends all of a person's sessions within a minute.
- Until Ember is set up, only the setup link the deploy printed opens the form, so finding a new
  deployment's address isn't enough to become its administrator; on localhost, and on a Worker
  without a setup token, setup is open or closed as [Deploying](#deploying) says.
- `EMBER_GUEST_SIGN_IN=true` lets anyone with the address in with just a name, so keep it to
  `wrangler dev`, as `.dev.vars.example` says.
- With Open on, anyone who finds the address can make an account, with any email address, and
  create rooms unless Must be admin to create new rooms is on. Turnstile, given its keys, keeps most
  bots out, and until then its limits keep a flood from filling the free plan. The join link has no
  limits, since its secrecy is the gate: regenerate it if it gets out.
- Email domain lets in whoever can read mail at its domains, so list only domains whose addresses
  your organization hands out: Membership warns of ones anyone can have an address at, such as
  gmail.com. Its page answers the same whether or not an address has an account, emailing someone
  who has one a way to sign in instead, so it tells strangers nothing of who's here.
- The Memberful site vouches for its members, so whoever runs it can sign in here as any of them who
  have, and while Memberful is on, add new ones. Administrators keep their passwords, so the site being down never locks
  them out. A webhook whose signature `MEMBERFUL_WEBHOOK_SECRET` doesn't check is refused, and even a
  signed one only has Ember ask Memberful's API about a member, so one forged or sent again changes
  nothing.
- Custom CSS runs on every page for everyone, so it's an administrator's to write, like the rest of
  the workspace, and `EMBER_RECOVERY_TOKEN` can take over any account, so keep it set only while
  resetting a password, as above.
- `/api/health` tells strangers only whether Ember is up; administrators and whoever sends the
  recovery token hear the rest. QR codes (`/qr_code/<id>`) are drawn for people signed in.

## Slack-compatible webhooks

Tools that post to Slack, such as Prometheus Alertmanager, Grafana or a CI pipeline, can post to a
room instead. The Chat bots page gives each of a bot's rooms a Slack-compatible webhook URL,
`https://<your Worker>/rooms/<room id>/<bot key>/slack`, which takes what a Slack incoming webhook
takes, as JSON or as a form's `payload` field:

```sh
curl -H 'Content-Type: application/json' -d '{"text": "Deploy *finished* :tada:"}' <url>
```

The bot posts the payload's `text`, read as Slack's mrkdwn, with its formatting, links, quotes, code
and emoji, and Ember answers as Slack does: `ok`, or what's wrong, such as `invalid_payload` or
`no_text`. Its legacy `attachments` show as cards under the text, each with a bar in its `color`,
and with its author, title, text, fields, image, link buttons and footer. Its Block Kit `blocks` show
as a card in place of the text, with headers, sections and their fields, context rows, rules, images,
rich text, Markdown, tables, small cards and carousels, and link buttons; buttons and menus only a
Slack app could answer are left out. Mentions of Slack's people and channels show as text and notify
nobody, and a payload can't change the bot's name, avatar or room.

Slack is a trademark of Slack Technologies, LLC. Ember is not created by, affiliated with, or
supported by Slack Technologies, LLC.

## Status

This is the starter. Working now: first-run setup, which creates the administrator and the rooms
general and random, the join link on general's welcome card, sign-in by email address and password
(10 tries per IP address every 3 minutes),
when `EMBER_GUEST_SIGN_IN` allows it by display name, or once an administrator turns it on with
Memberful, with a session cookie the Workspace keeps,
sign-out, which closes that browser's sockets, open and private rooms that only their members can
open (made through the API until the New room page lands), live messages with optimistic sends, edit
and delete your own messages, Ember's quick and tray reactions, presence, typing indicators, history
paging, reconnects, a sidebar that loads again whenever a tab reconnects, the Light / Dark / System appearance picker, the web app manifest that lets
browsers install Ember as an app, ember-rust's security headers and HTTPS, and its page for browsers
too old to run Ember. The rail's DMs, Activity, Search and Workspace entries are shown but disabled.

Next, roughly in order: a workspace directory for creating rooms and private rooms, direct messages,
unread state and the Activity filter, starred rooms and room order, rich text and attachments (R2),
search, and Web Push.
