import { isHttps } from "./auth";

// A Content-Security-Policy on everything the Worker answers, which Campfire and ember-rust go
// without: the backstop should markup ever get past the sanitizer, Lexxy or a dependency. Scripts
// run only from this origin and from a page's own inline scripts, named by hash; styles come from
// this origin or inline, which React's style attributes, Lexxy and an administrator's custom CSS
// need; images from this origin, any HTTPS host, since a preview shows its page's image, and data
// and blob URLs, which SVG previews and photos being picked use; and sockets open to this host alone.

/** Where browsers send what the policy blocked, which the Worker logs. */
export const CSP_REPORT_PATH = "/csp-report";

/** The most of a report that's read; a browser's is well under a kilobyte. */
const MAX_REPORT_BYTES = 8 * 1024;

/**
 * The policy for an answer to `request`, letting its page run the inline scripts whose SHA-256
 * hashes, in base64, are `scriptHashes`. Sockets name the host, since Safari reads `'self'` as the
 * page's own scheme alone, and on plain HTTP, as `wrangler dev` serves it, previews' images may load
 * over plain HTTP too.
 */
export function contentSecurityPolicy(request: Request, scriptHashes: readonly string[] = []): string {
  const { host } = new URL(request.url);
  const https = isHttps(request);
  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes.map((hash) => `'sha256-${hash}'`)].join(" "),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' https:${https ? "" : " http:"} data: blob:`,
    "media-src 'self' blob:",
    `connect-src 'self' ${https ? "wss" : "ws"}://${host}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

/** A script element with its own code, rather than a `src`, and that code. */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const encoder = new TextEncoder();

/** The SHA-256 hashes, in base64, of the inline scripts in `html`, as `script-src` names them. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const hashes: string[] = [];
  for (const [, script] of html.matchAll(INLINE_SCRIPT)) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(script)));
    hashes.push(btoa(String.fromCharCode(...digest)));
  }
  return hashes;
}

/** What a browser reports, in the `report-uri` format every browser still sends. */
interface Violation {
  "document-uri"?: string;
  "effective-directive"?: string;
  "violated-directive"?: string;
  "blocked-uri"?: string;
  "source-file"?: string;
  "line-number"?: number;
  "column-number"?: number;
}

/**
 * `POST /csp-report`, with what the policy blocked in a browser: logs it, so the Workers Logs show a
 * page the policy got in the way of, and answers 204. A body that isn't a browser's report answers
 * 400, and anything but a POST answers 404, as an address with no page does.
 */
export async function cspReport(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 404 });
  if (Number(request.headers.get("Content-Length")) > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  const body = await request.text();
  if (body.length > MAX_REPORT_BYTES) return new Response(null, { status: 413 });
  const violation = violationOf(body);
  if (!violation) return new Response(null, { status: 400 });
  console.warn("Content-Security-Policy violation", {
    page: violation["document-uri"],
    directive: violation["effective-directive"] ?? violation["violated-directive"],
    blocked: violation["blocked-uri"],
    source: violation["source-file"],
    line: violation["line-number"],
    column: violation["column-number"],
  });
  return new Response(null, { status: 204 });
}

/** The report in `body`, if it's a browser's. */
function violationOf(body: string): Violation | null {
  try {
    const report = (JSON.parse(body) as { "csp-report"?: unknown })["csp-report"];
    return report !== null && typeof report === "object" ? (report as Violation) : null;
  } catch {
    return null;
  }
}
