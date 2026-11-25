# Ember for desktop

Ember's app for Mac, Windows and Linux. It opens each Ember site's own web app in windows of its own,
so an Ember lives in the Dock or taskbar, with menus, huddles, notifications and a count of what's
unread, wherever the site is hosted. The
app holds no Ember of its own: each site serves its pages as it does to a browser, so the app shows
each site as up to date as the site is.

## Using it

The first time it opens, the app asks for the address of an Ember site, such as `chat.example.com`.
It checks that an Ember answers there, over HTTPS (or plain HTTP on your own computer, for
`localhost`), and opens the site's window, where you sign in as you would in a browser. **Sites**
adds more, lists them with ⌘1 to ⌘9 (Ctrl on Windows and Linux) to bring each to the front, and
removes the one in front, which forgets its address and your sign-in there.

- Each site keeps its sign-in, storage and permissions apart from every other site's, as a browser
  profile would.
- Closing a site's window puts it out of sight, still running, so its notifications keep coming until
  you quit the app. They show as your system's, once each however many of the site's windows are
  open, naming the site once you've added another, and clicking one opens its page in the site's window.
  The app's icon counts what every site has unread: on the Dock, on a Linux dock that shows counts, and
  drawn over the taskbar's icon on Windows.
- Opening Ember again brings its windows back, as does clicking its icon in the Dock on a Mac. On
  Windows and Linux, the app keeps an icon in the notification area or tray while it runs, where the
  desktop has one: clicking it brings the app back, and its menu opens each site's window, adds a site,
  or quits Ember.
- As it quits, the app remembers which sites' windows were showing, and where, and shows them again as
  it next starts, the rest out of sight, running.
- A site's window stays on the site. Links elsewhere open in your browser, email addresses in your
  email app, and Sign in with Memberful or SSO, and connecting your account there, pass through the
  site's Memberful site or single sign-on provider, at its custom domain if it has one, and come back.
  A provider that sends you on to another site to sign in opens that one in your browser instead.
  Where Memberful emails you a link to sign in, the link opens in your browser rather than the app, so
  type the code in the same email into the app's window instead. A site that emails Memberful's members
  a code itself asks for it on its own sign-in page, with no link to follow, so signing in stays on the
  site. A site that moves to its custom domain is followed there. A page of the site that opens in a
  new tab opens in a window of its own, which is the site's too.
- The site's own pages may use the camera, microphone and speakers for huddles, notifications, the
  clipboard, full screen and keeping the screen awake, and nothing else. On a Mac, macOS asks once whether Ember
  may use the camera and microphone, and the app says where in System Settings to allow them if not.
- Downloads ask where to save, starting in your Downloads folder.

Not yet: sharing a screen in a huddle; links that open the app; and updates, which wait on signing
(below). Until then, a new version is downloaded and installed by hand.

## Opening a build that isn't signed

Builds aren't signed or notarized yet, so each system warns before it opens one.

- **Mac:** open the `.dmg` and drag Ember into Applications, then open it. The first time, macOS says
  it couldn't verify Ember and doesn't open it. Choose **Done**, open **System Settings**, choose
  **Privacy & Security**, scroll down, and click **Open Anyway** beside the note about Ember. Confirm
  when macOS asks again, with your password if it asks for it, and Ember opens, as it does from then on.
  Since macOS 15, Control-clicking Ember and choosing **Open** no longer gets past the warning. Or run
  `xattr -dr com.apple.quarantine /Applications/Ember.app` in Terminal, then open Ember, which also works
  when macOS says Ember is damaged. An unsigned build keeps your sign-ins unencrypted on your Mac, since
  macOS would ask for your keychain's password as each new one starts; signed builds will encrypt them.
- **Windows:** run the installer, and when SmartScreen says it protected your PC, choose **More info**,
  then **Run anyway**.
- **Linux:** make the `.AppImage` runnable (`chmod +x Ember-*.AppImage`) and run it, or install the
  `.deb` with `sudo apt install ./Ember-*.deb`.

## Developing it

The app is a project of its own, outside Ember's pnpm workspace, so that installing Ember, Workers
Builds and Deploy to Cloudflare never download Electron. Work on it from this folder:

```sh
pnpm install          # its own lockfile, pnpm-lock.yaml here
pnpm start            # builds it into dist/ and opens it
pnpm typecheck
pnpm test             # the unit tests beside the code (src/*.test.ts)
pnpm test:app         # starts the built app with Playwright and drives it (test/)
pnpm package          # packages it for the system you're on, into release/
```

On a Mac without a Developer ID certificate, package it as CI does, signed ad hoc with sign-ins
unencrypted: `pnpm package -c.mac.identity=- -c.mac.hardenedRuntime=false -c.electronFuses.enableCookieEncryption=false`.

`pnpm test:app` adds made-up Ember sites, served by the tests on your computer, and keeps each test's
sites in a folder of its own. On Linux it needs a display: run it under `xvfb-run`, and on Ubuntu 24.04
or later let Electron's sandbox start with `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.

The code is in `src/`: `main.ts` starts the app, `site-window.ts` opens each site's window and keeps it
to the site (with `navigation.ts`), `site-session.ts` keeps each site's session and what it may use
(`permissions.ts`), `site-check.ts` checks an address is an Ember, and `pages/` holds the app's own
pages, Add Site and the page a window shows when its site doesn't answer. A site's pages hand the app
what Ember's workspace socket says a push would show, since no push service reaches Electron, and how
many conversations are unread, through `preload/site.cts` and `site-bridge.ts`, which match Ember's
`apps/web/src/lib/desktop-app.ts`; `site-notifications.ts` shows the notifications, `app-badge.ts`
counts the unread on the app's icon (drawn by `badge-image.ts` on Windows), and `tray.ts` keeps the
tray's icon. Electron's security checklist holds throughout: every window is sandboxed with context
isolation and no Node, and only two kinds of page have a preload: Add Site's, which exposes one
function, and the sites' windows', whose bridge the app heeds only from the site's own pages.

GitHub Actions' **Desktop** workflow type-checks, tests and packages the app on macOS, Windows and
Linux whenever a pull request changes it, and keeps each system's packages for a week.
