// Looking names up with Cloudflare's DNS over HTTPS, in its JSON form
// (https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/), as
// unfurling resolves a link's host and Set up email checks a domain Cloudflare Email Service sends from.

/** Cloudflare's DNS over HTTPS, which `node:dns` also uses in a Worker. */
const DNS_OVER_HTTPS = "https://cloudflare-dns.com/dns-query";
/** The types of record Ember looks up, by the numbers its answers give them. */
const RECORD_TYPES = { A: 1, AAAA: 28, MX: 15, TXT: 16 } as const;
const NOERROR = 0;
const NXDOMAIN = 3;

/** A type of record Ember looks up. */
export type RecordType = keyof typeof RECORD_TYPES;

/** What asks Cloudflare's resolver: the Worker's own `fetch`, with a signal, or a test's stand-in. */
export type DnsFetch = (request: Request) => Promise<Response>;

interface DnsJson {
  Status: number;
  Answer?: Array<{ type: number; data: string }>;
}

/**
 * The data of `name`'s records of `type`, as the resolver writes them, asked through `fetch`: one
 * subrequest. None for a name that doesn't exist, and an error thrown when the resolver doesn't answer.
 */
export async function lookUp(name: string, type: RecordType, fetch: DnsFetch): Promise<string[]> {
  const query = `${DNS_OVER_HTTPS}?name=${encodeURIComponent(name)}&type=${type}`;
  const response = await fetch(new Request(query, { headers: { Accept: "application/dns-json" } }));
  if (!response.ok) throw new Error(`DNS over HTTPS answered ${response.status}`);
  const { Status, Answer = [] } = await response.json<DnsJson>();
  if (Status === NXDOMAIN) return [];
  if (Status !== NOERROR) throw new Error(`DNS over HTTPS answered rcode ${Status}`);
  return Answer.filter((record) => record.type === RECORD_TYPES[type]).map((record) => record.data);
}
