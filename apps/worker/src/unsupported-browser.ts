import { isAppleMessages, isUnsupportedBrowser } from "./user-agent";

// ember-rust's AllowBrowser (crates/ember/src/concerns.rs `allow_browser`): an old browser gets
// "Upgrade to a supported web browser" (crates/views/templates/sessions/incompatible_browser.html),
// with status 200, whatever it asked for. The Worker writes the page itself, in plain CSS old
// browsers can read, since the app's stylesheet needs the browsers the page names. It's the
// signed-out layout whoever asks, as nothing past it runs there. The translation globe beside the
// message is hidden, as ember-rust hides it until an administrator shows translation buttons.

/** The browsers the page names and the version each needs: `ALLOW_BROWSER_VERSIONS` in crates/views/src/sessions.rs. */
const SUPPORTED_BROWSERS = [
  ["safari", "Safari", "17.2"],
  ["chrome", "Chrome", "120"],
  ["firefox", "Firefox", "121"],
  ["opera", "Opera", "104"],
] as const;

const browserList = SUPPORTED_BROWSERS.map(
  ([file, name, version]) =>
    `<div class="browser"><img src="/browsers/${file}.svg" alt="" aria-hidden="true"><div><strong>${name}</strong><span> ${version}+</span></div></div>`,
).join("\n          ");

/**
 * The page. It applies the app's saved appearance, or the system's, before it paints, as index.html
 * does. Its styles are the palette (zz-ember.css's canvas, surface, border and ink, as index.css has
 * them), the signed-out panel from zz-ember.css and Campfire's `.browser-list` from signup.css, with
 * margins for the gaps, which older browsers lay out.
 */
const page = (title: string) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="color-scheme" content="light dark">
    <title>${title}</title>
    <link rel="icon" type="image/png" sizes="48x48" href="/logos/app-icon-48.png">
    <link rel="apple-touch-icon" href="/logos/app-icon.png">
    <script>
      (function () {
        var saved, dark = false;
        try { saved = localStorage.getItem("ember:appearance"); } catch (e) {}
        try { dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches); } catch (e) {}
        if (dark) document.documentElement.className = "dark";
      })();
    </script>
    <style>
      html { background: #fafafa; color: #171717; }
      html.dark { background: #1c1c1c; color: #f5f5f5; }
      body {
        margin: 0;
        padding: 60px 0 1px;
        font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        -webkit-font-smoothing: antialiased;
        -webkit-text-size-adjust: none;
      }
      .panel {
        box-sizing: border-box;
        width: 480px;
        max-width: calc(100% - 48px);
        margin: 48px auto 28px;
        margin-top: clamp(24px, 7vh, 88px);
        padding: 32px;
        padding: clamp(20px, 3vw, 32px);
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 14px;
      }
      .dark .panel { background: #171717; border-color: #343434; }
      h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.2; letter-spacing: -0.025em; text-align: center; }
      h1, p { word-wrap: break-word; overflow-wrap: anywhere; }
      p { margin: 0 0 14px; }
      .browser-list { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; margin: 16px 0; }
      .browser { display: flex; flex-direction: column; flex-basis: 20%; margin: 0 0.5ch; }
      .browser img { display: block; width: 7ch; height: 7ch; margin: 0 auto; }
      .browser div { display: flex; flex-direction: column; align-items: center; margin-top: 8px; }
      @media (max-width: 900px) {
        body { padding-top: 56px; padding-top: calc(56px + env(safe-area-inset-top)); }
        .panel { margin: 18px auto 16px; max-width: calc(100% - 24px); padding: 20px 16px; border-radius: 12px; }
        h1 { font-size: 22px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="panel">
        <header>
          <h1>Upgrade to a supported web browser</h1>
          <p>Ember requires a modern web browser. Please use one of the browsers listed below and make sure auto-updates are enabled.</p>
        </header>
        <div class="browser-list">
          ${browserList}
        </div>
      </div>
    </main>
  </body>
</html>
`;

/** Whether `request` gets the upgrade page. The live connection isn't checked, as ember-rust's isn't. */
export const isFromUnsupportedBrowser = (request: Request) =>
  request.headers.get("Upgrade") !== "websocket" && isUnsupportedBrowser(request.headers.get("User-Agent"));

/** The upgrade page, titled "Ember" for Apple Messages' link previews rather than with a warning. */
export function unsupportedBrowserPage(request: Request): Response {
  const title = isAppleMessages(request.headers.get("User-Agent")) ? "Ember" : "Unsupported browser";
  return new Response(page(title), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
