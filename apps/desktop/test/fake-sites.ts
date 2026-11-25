import http from "node:http";
import type { AddressInfo } from "node:net";

// Made-up sites for the app's tests, on this computer, each at an origin of its own: Ember sites, which
// answer `/api/bootstrap` as Ember does and show a page of what a site's window can be asked to do; a
// Memberful site and a single sign-on provider to sign in at; a site that isn't Ember; one that sends
// everything on to another; and one that never stops answering.

/** A made-up site, listening until it's closed. */
export interface FakeSite {
  /** Its origin, such as http://127.0.0.1:50123. */
  origin: string;
  /** Its address with `host` in place of 127.0.0.1, as another origin for the same site. */
  at(host: string): string;
  /** Stops answering, as a site that's gone offline. */
  close(): Promise<void>;
  /** Starts answering again, at the same port. */
  reopen(): Promise<void>;
}

/** An Ember site whose workspace is `name`, which a test can move to a custom domain. */
export interface FakeEmber extends FakeSite {
  name: string;
  /** The host the site says it moved to, which its pages then move to, or null. */
  customDomain: string | null;
  /** The origin its server sends its pages at any other on to, the same page there, as a server does for a site that's moved, or null. */
  redirectsTo: string | null;
  /** Where its Sign in with Memberful sends people: a Memberful site's origin. */
  memberful: string | null;
  /** Where its Sign in with SSO sends people: a single sign-on provider's origin, or null while it has none. */
  sso: string | null;
  /** How many times it's been asked where its Sign in with Memberful goes. */
  signInsAsked: number;
  /** Keeps it from saying where its Sign in with Memberful goes, as a slow site would, until the function it returns is called. */
  holdSignIn(): () => void;
}

type Handler = (request: http.IncomingMessage, response: http.ServerResponse, url: URL) => void;

/** A site answering with `handle`, at an address of its own. */
async function serve(handle: Handler): Promise<FakeSite> {
  const server = http.createServer((request, response) => handle(request, response, new URL(request.url ?? "/", `http://${request.headers.host}`)));
  const listen = (port = 0) => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  await listen();
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    at: (host) => `http://${host}:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
    reopen: () => listen(port),
  };
}

const html = (response: http.ServerResponse, body: string, status = 200) => {
  response.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><meta charset="utf-8">${body}`);
};

const redirect = (response: http.ServerResponse, location: string, cookie?: string) => {
  response.writeHead(302, { Location: location, ...(cookie ? { "Set-Cookie": cookie } : {}) });
  response.end();
};

/**
 * An Ember site whose workspace is `name`. Its pages say whether this browser is signed in, which
 * /sign-in or Sign in with Memberful or SSO do, and link to the site's next room, to a site elsewhere, to
 * a file to download, to Sign in with Memberful and SSO, and straight to the Memberful site's and the
 * provider's sign-ins, as connecting an account there does.
 */
export async function fakeEmber(name: string): Promise<FakeEmber> {
  let signInHeld = Promise.resolve();
  const site: FakeEmber = Object.assign(
    await serve((request, response, url) => {
      const signedIn = request.headers.cookie?.includes("session=") ?? false;
      if (site.redirectsTo !== null && url.origin !== site.redirectsTo) return redirect(response, `${site.redirectsTo}${url.pathname}${url.search}`);
      switch (url.pathname) {
        case "/api/bootstrap":
          response.writeHead(200, { "Content-Type": "application/json" });
          return response.end(JSON.stringify({ setup: "complete", version: "test", account: { name: site.name, customDomain: site.customDomain }, user: signedIn ? { name: "Ada" } : null }));
        case "/sign-in":
          return redirect(response, "/", "session=ada; Path=/; HttpOnly; Max-Age=86400");
        case "/auth/memberful":
          site.signInsAsked++;
          return void signInHeld.then(() => redirect(response, `${site.memberful}/oauth?client_id=ember&state=1&site=${encodeURIComponent(url.origin)}`));
        case "/auth/memberful/callback":
          return redirect(response, "/", "session=ada-from-memberful; Path=/; HttpOnly; Max-Age=86400");
        case "/auth/sso":
          return redirect(response, site.sso === null ? "/?sso=off" : ssoSignInAt(site.sso, url.origin, "3"));
        case "/auth/sso/callback":
          return redirect(response, "/", "session=ada-from-sso; Path=/; HttpOnly; Max-Age=86400");
        case "/files/report.txt":
          response.writeHead(200, { "Content-Type": "text/plain", "Content-Disposition": 'attachment; filename="Q3 report.txt"' });
          return response.end("Sales are up.");
        default:
          return html(
            response,
            `<title>general</title>
            <h1>${signedIn ? "Signed in" : "Signed out"} at ${site.name}</h1>
            <a href="/rooms/2">Next room</a>
            <a href="https://example.com/elsewhere">Elsewhere</a>
            <a href="/files/report.txt" download>Download the report</a>
            <a href="/auth/memberful">Sign in with Memberful</a>
            <a href="${site.memberful}/oauth?client_id=ember&state=2&site=${encodeURIComponent(url.origin)}">Connect Memberful</a>
            <a href="/auth/sso">Sign in with SSO</a>
            <a href="${site.sso === null ? "/" : ssoSignInAt(site.sso, url.origin, "4")}">Connect SSO</a>`,
          );
      }
    }),
    {
      name,
      customDomain: null,
      redirectsTo: null,
      memberful: null,
      sso: null,
      signInsAsked: 0,
      holdSignIn() {
        let answer = () => {};
        signInHeld = new Promise((resolve) => (answer = resolve));
        return answer;
      },
    },
  );
  return site;
}

/** A Memberful site, whose sign-in page sends people back to the Ember site they came from, or to its terms elsewhere. */
export function fakeMemberful(): Promise<FakeSite> {
  return serve((_request, response, url) => {
    if (url.pathname !== "/oauth") return html(response, "<title>Not found</title>", 404);
    const back = `${url.searchParams.get("site")}/auth/memberful/callback?code=1&state=${url.searchParams.get("state")}`;
    html(response, `<title>Sign in</title><h1>Sign in to Fernwood's Memberful</h1><a href="${back}">Allow</a> <a href="https://example.com/terms">Terms</a>`);
  });
}

/** The sign-in at the single sign-on provider at `provider` for the Ember site at `site`, with `state`, as Ember sends people there. */
const ssoSignInAt = (provider: string, site: string, state: string) =>
  `${provider}/authorize?response_type=code&client_id=ember&redirect_uri=${encodeURIComponent(`${site}/auth/sso/callback`)}&state=${state}`;

/** A single sign-on provider, whose sign-in page sends people back to the Ember site they came from. */
export function fakeSso(): Promise<FakeSite> {
  return serve((_request, response, url) => {
    if (url.pathname !== "/authorize") return html(response, "<title>Not found</title>", 404);
    const back = `${url.searchParams.get("redirect_uri")}?code=1&state=${url.searchParams.get("state")}`;
    html(response, `<title>Sign in</title><h1>Sign in to Fernwood's provider</h1><a href="${back}">Allow</a>`);
  });
}

/** A site that sends every page on to the same page at `to`, an origin, as a bare domain does to its www. */
export function fakeRedirect(to: string): Promise<FakeSite> {
  return serve((_request, response, url) => redirect(response, `${to}${url.pathname}${url.search}`));
}

/** A site whose answer to everything never ends, which a test can tell has been cut off. */
export interface FakeEndless extends FakeSite {
  /** How many of its answers are still being sent. */
  answering: number;
}

/** A site that answers everything with `status` and a body that never ends, as one out to fill the app's memory might. */
export async function fakeEndless(status: number): Promise<FakeEndless> {
  const more = Buffer.alloc(64 * 1024, " ");
  const site: FakeEndless = Object.assign(
    await serve((_request, response) => {
      site.answering++;
      response.once("close", () => site.answering--);
      response.writeHead(status, { "Content-Type": "application/json" });
      const send = () => {
        while (!response.destroyed && response.write(more));
      };
      response.on("drain", send);
      send();
    }),
    { answering: 0 },
  );
  return site;
}

/** A site that isn't Ember, whose pages can be framed, as a frame elsewhere in an Ember page would be. */
export function fakeElsewhere(): Promise<FakeSite> {
  return serve((_request, response) => html(response, "<title>A blog</title><h1>A blog</h1>", 200));
}
