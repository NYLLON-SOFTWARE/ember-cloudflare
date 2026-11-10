# Ember for Mac

A native macOS client for Ember, written in SwiftUI. It talks to any Ember deployment through the same
`/api/*` routes and WebSockets the web app uses, so the Worker needs no changes.

## Build and run

Requires macOS 14 or later and Xcode 16 or later (Swift 6).

```sh
cd clients/macos
./scripts/bundle.sh          # builds build/Ember.app (universal, ad-hoc signed)
open build/Ember.app
```

`swift run` also works while developing, but without an app bundle macOS gives it no notifications.

The app icon (`Resources/AppIcon.icns`) is made from Ember's flame logo
(`apps/web/public/logos/app-icon.png`, copied to `Sources/EmberDesktop/Resources/ember-logo.png`).
To regenerate it after the logo changes, run:

```sh
swift scripts/make-icon.swift Sources/EmberDesktop/Resources/ember-logo.png Resources
```

Sign in with your Ember's address (for example `chat.example.com` or `ember.<you>.workers.dev`), and
the email and password you use on the web.

## What it does

- Signs in with email and password. The session cookie is stored in the system cookie store, so you
  stay signed in between launches.
- Shows the sidebar: starred rooms, rooms in the workspace's shared order, and DMs ordered by latest
  activity. Unread rooms are shown in bold, and the Dock badge counts them.
- Shows a room's timeline live: new messages, edits, deletes, reactions, who's present, and who's
  typing. Scrolling to the top loads older messages.
- Sends messages. Return sends, and Shift-Return or Option-Return starts a new line. You can edit and
  delete your own messages (administrators can delete anyone's), and add or remove reactions.
- Shows image attachments inline and links other files for download.
- When a room turns unread while the app is in the background, it posts a local notification. Clicking
  the notification opens that room.

Not yet: threads (they show only a reply count), uploads, search, huddles, workspace settings, rich-text
formatting, or signing in with Memberful or a sign-in link.

## How it talks to Ember

- **Auth.** `POST /api/session` sets an HttpOnly session cookie (`__Host-session_token` over HTTPS).
  The Worker refuses writes and socket upgrades that don't look same-origin (`isCrossSite` and
  `isSameOriginUpgrade` in `apps/worker/src/auth.ts`). To pass those checks, every request carries
  `Origin: <server>` and `Sec-Fetch-Site: same-origin`. Socket upgrades attach the cookie by hand.
- **Workspace socket** (`/api/socket`) keeps the sidebar current, using `WorkspaceServerFrame`.
- **Room sockets** (`/api/rooms/:id/socket?visible=…&protocol=4&since=…`), using `ClientFrame` and
  `ServerFrame`. On reconnect the client passes `since` (the last `seq` it saw), and the room replies
  with only what changed (`resumed`). Messages sent while disconnected are confirmed with
  `message.check`.
- **Message bodies** are sent in the plain-paragraph form (`<p>…<br>…</p>`, with `&<>` escaped) that
  `packages/richtext` stores without parsing. Messages are shown from their `plainText`.

The frame types are mirrored in `Sources/EmberDesktop/Frames.swift`. If `packages/protocol` changes a
frame or bumps `ROOM_PROTOCOL`, update that file to match. Unknown frame types are ignored, so a newer
server won't break an older client.

## Push notifications

Ember's push uses Web Push (VAPID), which a native app can't receive. So the client only notifies
while it's running. Notifying while it's closed would need APNs support in the Worker.

## Tests

```sh
swift test                   # protocol encoding/decoding
```

To also run the live test against a running Ember (for example `pnpm dev` in `apps/worker`), set:

```sh
EMBER_TEST_SERVER=http://localhost:8787 EMBER_TEST_EMAIL=… EMBER_TEST_PASSWORD=… swift test
```

The live test signs in, loads the sidebar, opens a room, sends a message, reacts to it, and deletes it.
