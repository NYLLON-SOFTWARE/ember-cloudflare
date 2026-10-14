import type { Env } from "./env";
import { ACCOUNT_NAME, workspace } from "./workspace";

// The web app manifest, which lets browsers install Ember as an app: ember-rust's
// crates/views/templates/pwa/manifest.json, served by crates/ember/src/controllers/pwa.rs.

/**
 * What the manifest says the app is. ember-rust keeps Campfire's "A chat app from the makers of
 * Basecamp and HEY.", which isn't this project, so this is the README's own description.
 */
const DESCRIPTION = "A real-time chat app that runs entirely on Cloudflare.";

/**
 * The manifest for a workspace named `name`. Its icons are Ember's stock ones until workspaces have
 * logos, and it lists none of ember-rust's screenshots, which show Campfire's Android app.
 */
export function webManifest(name: string) {
  return {
    name,
    icons: [
      { src: "/logos/app-icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512" },
      { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
    start_url: "/",
    display: "standalone",
    scope: "/",
    description: DESCRIPTION,
    categories: ["social", "business", "productivity"],
    theme_color: "#ffffff",
    background_color: "#ffffff",
    shortcuts: [
      // Relative, as in ember-rust, so it resolves against the manifest's address to /rooms/opens/new.
      { name: "New chat room", description: "Open Ember and start a new chat room", url: "rooms/opens/new", icons: [{ src: "/shortcuts/add.svg", sizes: "any" }] },
      { name: "My profile", description: "Open Ember and view your profile", url: "/users/me/profile", icons: [{ src: "/shortcuts/person.svg", sizes: "any" }] },
    ],
  };
}

/** The format a request for the manifest asks for: "" for /webmanifest, "json" for /webmanifest.json, or null for any other path. */
export function manifestFormatOf(pathname: string): string | null {
  const match = pathname.match(/^\/webmanifest(?:\.(.+))?$/);
  return match ? (match[1] ?? "") : null;
}

/** `GET /webmanifest.json`, which pages link, and `/webmanifest`: public, and named after the workspace. */
export async function manifest(env: Env, format: string): Promise<Response> {
  // As in ember-rust, which answers only JSON.
  if (format !== "" && format !== "json") return new Response(null, { status: 406 });
  const account = await workspace(env).account();
  return new Response(JSON.stringify(webManifest(account?.name ?? ACCOUNT_NAME)), {
    // Revalidated every time, so an installed app finds a renamed workspace or a new logo.
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
