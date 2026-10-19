import { escapeHtml } from "./encoding";

// ember-rust's locked page (crates/ember/src/controllers/first_runs/access.rs) is bare: "Setup is
// locked" and "Open the private setup link printed by the installer.", in the browser's own fonts,
// which reads as a broken page. This one is drawn as the Set up Ember form's card, whose place it
// takes (apps/web/src/components/setup-page.tsx), in Ember's palette (apps/web/src/index.css), and
// says why setup is locked and how to unlock it, the link's address included, as there's no
// installer to print it. With no script, it follows the device's appearance rather than a saved one.

/** The page that answers for setup, for `origin`, while this browser hasn't opened the private setup link. */
export const lockedPage = (origin: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Ember setup</title>
<link rel="icon" type="image/png" sizes="48x48" href="/logos/app-icon-48.png">
<link rel="apple-touch-icon" href="/logos/app-icon.png">
<style>
  *, ::before, ::after { box-sizing: border-box; }
  :root { --surface: #fafafa; --card: #ffffff; --foreground: #171717; --muted: #f2f2f2; --muted-foreground: #737373; --border: #e5e5e5; }
  @media (prefers-color-scheme: dark) {
    :root { --surface: #1c1c1c; --card: #1c1c1c; --foreground: #f5f5f5; --muted: #282828; --muted-foreground: #a3a3a3; --border: #343434; }
  }
  body {
    display: grid;
    grid-template-columns: minmax(0, 28rem);
    place-content: center;
    min-height: 100vh;
    min-height: 100svh;
    margin: 0;
    padding: calc(2.5rem + env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) calc(2.5rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
    background: var(--surface);
    color: var(--foreground);
    font: 1rem/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  section { overflow: hidden; border: 1px solid var(--border); border-radius: 1rem; background: var(--card); }
  header { display: flex; flex-direction: column; align-items: center; padding: 1.25rem 1.25rem 0; text-align: center; }
  img { display: block; width: 3rem; height: 3rem; margin-bottom: 1rem; object-fit: contain; }
  h1 { margin: 0; font-size: 1.5rem; line-height: 1.3; font-weight: 550; letter-spacing: -0.025em; }
  header p { margin: 0.5rem 0 0; color: var(--muted-foreground); text-wrap: balance; }
  ul { display: grid; gap: 1.25rem; margin: 0; padding: 1.5rem 1.25rem 1.75rem; list-style: none; }
  strong { font-weight: 600; }
  code, pre { border-radius: 0.375rem; background: var(--muted); font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monaco, monospace; }
  code { padding: 0.1em 0.3em; font-size: 0.875em; }
  pre { margin: 0.5rem 0 0; padding: 0.5rem 0.75rem; font-size: 0.875rem; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 23.75rem) {
    body { padding-top: calc(1.25rem + env(safe-area-inset-top)); padding-bottom: calc(1.25rem + env(safe-area-inset-bottom)); }
    h1 { font-size: 1.375rem; }
    header p, ul { font-size: 0.875rem; }
  }
</style>
</head>
<body>
<main>
  <section aria-labelledby="title">
    <header>
      <img src="/ember-icon.png" alt="Ember" width="48" height="48">
      <h1 id="title">Setup is locked</h1>
      <p>Whoever sets up Ember becomes its administrator, so setup only opens from this deployment's private link.</p>
    </header>
    <ul>
      <li><strong>Have the link?</strong> Open it in this browser. It unlocks setup here for a day.</li>
      <li><strong>No link?</strong> It's this address followed by the setup token, the Worker's <code>EMBER_SETUP_TOKEN</code> secret:<pre>${escapeHtml(origin)}/<wbr>first_run/<wbr>access#token=</pre></li>
      <li><strong>Lost the token?</strong> Run these to make a new one and save it as that secret, then open the link with it.<pre>openssl rand -hex 32
wrangler secret put EMBER_SETUP_TOKEN</pre></li>
    </ul>
  </section>
</main>
</body>
</html>
`;
