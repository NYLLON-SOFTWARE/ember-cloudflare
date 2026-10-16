import type { Env } from "./env";
import { notFound } from "./error-pages";
import { etagOf, isFresh } from "./etag";

// The workspace's logo, ported from ember-rust's crates/ember/src/controllers/accounts/logos.rs: a PNG
// anyone may fetch, so it can be a push's icon. Nobody can upload a logo yet, so it's Ember's stock
// app icon, from the built app's files.

/** `expires_in 5.minutes, public: true, stale_while_revalidate: 1.week` */
const CACHE_CONTROL = "max-age=300, public, stale-while-revalidate=604800";

/** Whether `pathname` is the logo's, which ember-rust's router takes with any format. */
export const isAccountLogoPath = (pathname: string) => /^\/account\/logo(?:\.[^/.]+)?$/.test(pathname);

/**
 * `GET /account/logo`: the stock app icon, or its 192-pixel one with `?size=small`, as ember-rust sends
 * them when the workspace has no logo. A 304 says how long to keep the copy too, as avatars' do.
 */
export async function showAccountLogo(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(request);
  const file = new URL(request.url).searchParams.get("size") === "small" ? "app-icon-192.png" : "app-icon.png";
  const icon = await env.ASSETS.fetch(new URL(`/logos/${file}`, request.url));
  if (!icon.ok) throw new Error(`The stock icon ${file} answered ${icon.status}`);
  const bytes = new Uint8Array(await icon.arrayBuffer());
  const etag = await etagOf(bytes);
  const headers = new Headers({ ETag: etag, "Cache-Control": CACHE_CONTROL });
  if (isFresh(request, etag)) return new Response(null, { status: 304, headers });
  headers.set("Content-Type", "image/png");
  headers.set("Content-Disposition", `inline; filename="${file}"; filename*=UTF-8''${file}`);
  return new Response(request.method === "HEAD" ? null : bytes, { headers });
}
