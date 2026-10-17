import { TRANSLATIONS } from "@ember/protocol";
import type { Env } from "./env";
import { escapeHtml } from "./headers";
import { isAppleMessages, isUnsupportedBrowser } from "./user-agent";
import { workspace } from "./workspace";

// ember-rust's AllowBrowser (crates/ember/src/concerns.rs `allow_browser`): an old browser gets
// "Upgrade to a supported web browser" (crates/views/templates/sessions/incompatible_browser.html),
// with status 200, whatever it asked for. The Worker writes the page itself, in plain CSS old
// browsers can read, since the app's stylesheet needs the browsers the page names. It's the
// signed-out layout whoever asks, as nothing past it runs there. The translation globe beside the
// message shows once an administrator shows translation buttons, as ember-rust's does.

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
 * ember-rust's `translation_button(ctx, "incompatible_browser_messsage")` (crates/views/src/helpers/translations.rs):
 * Campfire's globe on a `<details>` whose summary Tab skips, listing the message in seven languages.
 * Escape or a click elsewhere closes it, as Campfire's popup_controller.js does. The summary opens
 * and closes it too, by its `open` attribute, as Internet Explorer has no details element, and the
 * list hides itself while that's missing.
 */
const globe = `<details class="translations">
              <summary tabindex="-1"><img src="/globe.svg" alt="" aria-hidden="true"><span class="for-screen-reader">Translate</span></summary>
              <div class="language-list-menu"><dl class="language-list">${TRANSLATIONS.incompatible_browser_messsage.map(([flag, text]) => `<dt>${flag}</dt><dd>${escapeHtml(text)}</dd>`).join("")}</dl></div>
            </details>`;

const togglesGlobe = `<script>
      (function () {
        var globe = document.querySelector(".translations");
        globe.querySelector("summary").addEventListener("click", function (event) {
          event.preventDefault();
          if (globe.hasAttribute("open")) globe.removeAttribute("open");
          else globe.setAttribute("open", "");
        });
        globe.addEventListener("keydown", function (event) {
          if (event.key === "Escape" || event.keyCode === 27) globe.removeAttribute("open");
        });
        document.addEventListener("click", function (event) {
          if (!globe.contains(event.target)) globe.removeAttribute("open");
        });
      })();
    </script>`;

/**
 * The page. It applies the app's saved appearance, or the system's, before it paints, as index.html
 * does. Its styles are the palette (zz-ember.css's canvas, surface, border and ink, as index.css has
 * them), the signed-out panel from zz-ember.css, Campfire's `.browser-list` from signup.css, and the
 * globe as the app draws it (translation-button.tsx), with margins for the gaps, which older browsers
 * lay out, and the list kept to a narrow screen by its own width, and 40ch wide in Internet Explorer,
 * which has no `max-content`.
 */
const page = (title: string, translations: boolean) => `<!DOCTYPE html>
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
      .message { display: flex; align-items: flex-start; }
      .translations { position: relative; flex: none; margin-right: 1ch; }
      .translations summary {
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 36px;
        height: 36px;
        background: #fff;
        border: 1px solid #e5e5e5;
        border-radius: 50%;
        cursor: pointer;
        list-style: none;
      }
      .translations summary::-webkit-details-marker { display: none; }
      .translations img { display: block; width: 1.3em; height: 20px; }
      .dark .translations summary { background: #171717; border-color: #343434; }
      .translations:not([open]) .language-list-menu { display: none; }
      .language-list-menu {
        position: absolute;
        z-index: 3;
        margin: 0 1ch;
        width: 40ch;
        width: max-content;
        max-width: 40ch;
        overflow: hidden;
        background: #e5e5e5;
        border: 1px solid #e5e5e5;
        border-radius: 0.5em;
        box-shadow: 0 8px 24px #00000012;
      }
      .dark .language-list-menu { background: #343434; border-color: #343434; }
      .language-list {
        display: grid;
        grid-template-columns: min-content 1fr;
        grid-gap: 8px 1ch;
        gap: 8px 1ch;
        box-sizing: border-box;
        max-width: calc(100vw - 72px);
        margin: 0;
        padding: 16px 2ch;
      }
      .language-list dd { margin: 0; }
      .for-screen-reader { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
      @media (max-width: 900px) {
        body { padding-top: 56px; padding-top: calc(56px + env(safe-area-inset-top)); }
        .panel { margin: 18px auto 16px; max-width: calc(100% - 24px); padding: 20px 16px; border-radius: 12px; }
        h1 { font-size: 22px; }
        .translations summary { width: 44px; height: 44px; }
      }
      @media (pointer: coarse) {
        .translations summary { width: 44px; height: 44px; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="panel">
        <header>
          <h1>Upgrade to a supported web browser</h1>
          <div class="message">
            ${translations ? globe : ""}
            <p>Ember requires a modern web browser. Please use one of the browsers listed below and make sure auto-updates are enabled.</p>
          </div>
        </header>
        <div class="browser-list">
          ${browserList}
        </div>
      </div>
    </main>
    ${translations ? togglesGlobe : ""}
  </body>
</html>
`;

/** Whether `request` gets the upgrade page. The live connection isn't checked, as ember-rust's isn't. */
export const isFromUnsupportedBrowser = (request: Request) =>
  request.headers.get("Upgrade") !== "websocket" && isUnsupportedBrowser(request.headers.get("User-Agent"));

/**
 * The upgrade page, titled "Ember" for Apple Messages' link previews rather than with a warning, with the
 * globe once the workspace shows translation buttons.
 */
export async function unsupportedBrowserPage(request: Request, env: Env): Promise<Response> {
  const title = isAppleMessages(request.headers.get("User-Agent")) ? "Ember" : "Unsupported browser";
  const account = await workspace(env).account();
  return new Response(page(title, account?.hideTranslationButtons === false), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
