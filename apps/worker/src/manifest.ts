import type { Env } from "./env";
import { ACCOUNT_NAME, workspace } from "./workspace";

// The web app manifest, which lets browsers install Ember as an app: Campfire's
// app/views/pwa/manifest.json.erb.

/**
 * What the manifest says the app is: the README's own description, since Campfire's "A chat app from the
 * makers of Basecamp and HEY." isn't this project.
 */
const DESCRIPTION = "Team Lopez — internal chat for the Victor Lopez for Hammond City Council campaign.";

/** The name the installed app shows when the workspace is still the stock one. */
const BRAND_NAME = "Team Lopez";

/**
 * The manifest for a workspace named `name` whose logo is at `logo`. Its icons are the logo's variants,
 * or Ember's stock icons while there's no logo. Its screenshots have Campfire's sizes and labels, but
 * they're Ember's own, which `pnpm screenshots` makes.
 */
export function webManifest(name: string, logo: string | null) {
  const [small, large] = logo ? [`${logo}&size=small`, logo] : ["/logos/app-icon-192.png", "/logos/app-icon.png"];
  return {
    name: name === "Ember" ? BRAND_NAME : name,
    short_name: BRAND_NAME,
    icons: [
      { src: small, type: "image/png", sizes: "192x192" },
      { src: large, type: "image/png", sizes: "512x512" },
      { src: large, type: "image/png", sizes: "512x512", purpose: "maskable" },
    ],
    start_url: "/",
    display: "standalone",
    scope: "/",
    description: DESCRIPTION,
    categories: ["social", "business", "productivity"],
    theme_color: "#000000",
    background_color: "#f2eee2",
    shortcuts: [
      // Relative, so it resolves against the manifest's address to /rooms/opens/new.
      { name: "New chat room", description: "Open Team Lopez and start a new chat room", url: "rooms/opens/new", icons: [{ src: "/shortcuts/plus.svg", sizes: "any" }] },
      { name: "My profile", description: "Open Team Lopez and view your profile", url: "/users/me/profile", icons: [{ src: "/shortcuts/user.svg", sizes: "any" }] },
    ],
    screenshots: [
      { src: "/screenshots/chat.png", sizes: "1080x2400", form_factor: "narrow", label: "Team Lopez is the campaign's installable team chat." },
      { src: "/screenshots/sidebar.png", sizes: "1080x2400", form_factor: "narrow", label: "Invite people. Make rooms. @mentions, DMs, and mobile support." },
      { src: "/screenshots/dark-mode.png", sizes: "1080x2400", form_factor: "narrow", label: "Light and dark, in the campaign's black, white, and gold." },
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
  // It's answered only as JSON.
  if (format !== "" && format !== "json") return new Response(null, { status: 406 });
  const account = await workspace(env).account();
  return new Response(JSON.stringify(webManifest(account?.name ?? ACCOUNT_NAME, account?.logo ?? null)), {
    // Revalidated every time, so an installed app finds a renamed workspace or a new logo.
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
