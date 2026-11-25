import { net, protocol, type Session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The app's own pages, such as Add Site, load from a scheme of its own rather than file:, which would
// give them more than a web page gets.

const SCHEME = "ember-app";
const PAGES = path.join(import.meta.dirname, "pages");

/** The address of the app's page in `file`, under its pages folder. */
export const pageAddress = (file: string) => `${SCHEME}://pages/${file}`;

/** Makes the app's pages secure ones, as a site's https pages are. Called before the app is ready. */
export function registerPagesScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true } }]);
}

/** Lets windows of `session` load the app's pages whose names start with one of `names`, and nothing else. */
export function servePages(session: Session, names: readonly string[]): void {
  session.protocol.handle(SCHEME, (request) => {
    const { host, pathname } = new URL(request.url);
    const file = path.join(PAGES, decodeURIComponent(pathname));
    const served = host === "pages" && path.dirname(file) === PAGES && names.some((name) => path.basename(file).startsWith(name));
    return served ? net.fetch(pathToFileURL(file).href) : new Response(null, { status: 404 });
  });
}
