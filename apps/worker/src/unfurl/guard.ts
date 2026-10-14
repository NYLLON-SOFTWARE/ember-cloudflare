import { isBlockedAddress, parseAddress } from "./addresses";

// ember-rust's private network guard (crates/ember/src/integrations/net/guard.rs, after Rails'
// `RestrictedHTTP::PrivateNetworkGuard`), with two differences that come from a Worker's `fetch`
// connecting by name, so the address checked can't be pinned for the connection:
//
// - A name must resolve only to public addresses. ember-rust drops the blocked ones and connects to
//   the first public one, which here would let the connection pick a blocked one.
// - A host written as an address, in any of the notations `inet_aton` reads (`127.0.0.1`,
//   `2130706433`, `0x7f.1`, `[::1]`), is never fetched, public or not. Workers can't fetch one anyway.

export class GuardError extends Error {
  override name = "GuardError";
}

/** A host's IPv4 and IPv6 addresses, for `host` alone, without a port. */
export type Resolve = (host: string) => Promise<string[]>;

const MAX_HOST_LENGTH = 255;
/** Surfguard's limit: more answers than this is a host that can't be resolved. */
const MAX_ADDRESSES = 256;
const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** `legacy_ipv4_shape`: 1 to 4 decimal or 0x-hex numbers, empty parts ignored, which `inet_aton` might read as an address. */
function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".").filter((part) => part !== "");
  return parts.length >= 1 && parts.length <= 4 && parts.every((part) => /^(?:0[xX][0-9A-Fa-f]+|\d+)$/.test(part));
}

/** Whether `host` is a name to look up: labels of letters, digits and hyphens, and not an address in any notation. */
export function isHostName(host: string): boolean {
  if (host.length > MAX_HOST_LENGTH || host.includes(":") || looksLikeIpv4(host)) return false;
  return (host.endsWith(".") ? host.slice(0, -1) : host).split(".").every((label) => LABEL.test(label));
}

/**
 * Checks that `host` is a name that resolves, and only to public addresses, throwing a GuardError with
 * ember-rust's message when it isn't.
 */
export async function checkHost(host: string, resolve: Resolve): Promise<void> {
  if (!isHostName(host)) throw new GuardError(`Attempt to access private IP via ${host}`);
  const answers = await resolve(host).catch(() => null);
  if (!answers || answers.length === 0 || answers.length > MAX_ADDRESSES) throw new GuardError("Host could not be resolved");
  for (const answer of answers) {
    const address = parseAddress(answer);
    if (address === null || isBlockedAddress(address)) throw new GuardError(`Attempt to access private IP via ${host}`);
  }
}

/** Cloudflare's DNS over HTTPS, which `node:dns` also uses in a Worker. */
const DNS_OVER_HTTPS = "https://cloudflare-dns.com/dns-query";
const RECORD_TYPES = { A: 1, AAAA: 28 } as const;
const NOERROR = 0;
const NXDOMAIN = 3;

interface DnsJson {
  Status: number;
  Answer?: Array<{ type: number; data: string }>;
}

/** A name's A and AAAA records from Cloudflare's resolver, asked through `fetch`: two subrequests. */
export async function resolveOverHttps(host: string, fetch: (request: Request) => Promise<Response>): Promise<string[]> {
  const lookups = (["A", "AAAA"] as const).map(async (type) => {
    const query = `${DNS_OVER_HTTPS}?name=${encodeURIComponent(host)}&type=${type}`;
    const response = await fetch(new Request(query, { headers: { Accept: "application/dns-json" } }));
    if (!response.ok) throw new Error(`DNS over HTTPS answered ${response.status}`);
    const { Status, Answer = [] } = await response.json<DnsJson>();
    if (Status === NXDOMAIN) return [];
    if (Status !== NOERROR) throw new Error(`DNS over HTTPS answered rcode ${Status}`);
    return Answer.filter((record) => record.type === RECORD_TYPES[type]).map((record) => record.data);
  });
  return (await Promise.all(lookups)).flat();
}
