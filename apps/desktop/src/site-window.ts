import { BrowserWindow, dialog, nativeTheme, net, screen, shell, type WebContents } from "electron";
import { pageAddress } from "./app-pages.ts";
import { contextMenuOf } from "./context-menu.ts";
import { destinationOf, mayBeMoving, mayBeSigningIn, passageOf } from "./navigation.ts";
import { checkSite, memberfulSiteOf } from "./site-check.ts";
import { sessionOf } from "./site-session.ts";
import type { Bounds, Site, Sites } from "./sites.ts";

/** How large a site's window opens the first time, and how small it can be made. */
const FIRST_SIZE = { width: 1280, height: 860 };
const SMALLEST = { minWidth: 400, minHeight: 500 };

/** Chromium's errors for a certificate it doesn't trust, from -200 to -299. */
const isCertificateError = (code: number) => code <= -200 && code > -300;

/** Chromium's error for a load that something else stopped, such as a newer one. */
const ABORTED = -3;

/**
 * Each site's window, which opens the site's own Ember and keeps to it, as a browser tab would, and
 * remembers where it was and whether it was open as the app quit, and the windows its pages open, which
 * keep to the site too.
 */
export class SiteWindows {
  readonly #sites: Sites;
  readonly #windows = new Map<string, BrowserWindow>();
  /** The windows the sites' pages opened, each with the id of the site whose pages opened it. */
  readonly #opened = new Map<BrowserWindow, string>();
  readonly #listeners = new Set<() => void>();
  #quitting = false;

  constructor(sites: Sites) {
    this.#sites = sites;
  }

  /** Brings the site's window to the front, opening it if it isn't open. */
  show(site: Site): void {
    const window = this.#windows.get(site.id) ?? this.#open(site);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Closes the site's windows that are open, its own and those its pages opened, asking its pages nothing. */
  close(id: string): void {
    for (const [window, site] of this.#opened) if (site === id) window.destroy();
    this.#windows.get(id)?.destroy();
  }

  /** The site whose window `window` is, or whose pages opened it, if it's either. */
  siteOf(window: BrowserWindow | null): Site | undefined {
    const id = window === null ? undefined : this.#idOf(window);
    return id === undefined ? undefined : this.#sites.find(id);
  }

  /** Whether any of the app's windows is open but the site with `id`'s, its own and those its pages opened. */
  anyOpenBut(id: string): boolean {
    return BrowserWindow.getAllWindows().some((window) => this.#idOf(window) !== id);
  }

  /** Remembers each window that closes from now on as open, to open it again as the app next starts. */
  quitting(): void {
    this.#quitting = true;
  }

  /** Calls `listener` whenever a window opens or closes. */
  onChange(listener: () => void): void {
    this.#listeners.add(listener);
  }

  #open(site: Site): BrowserWindow {
    const window = new BrowserWindow({
      ...FIRST_SIZE,
      ...onScreen(site.bounds),
      ...SMALLEST,
      title: site.name,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
      webPreferences: { session: sessionOf(site.id, () => this.#addressOf(site.id)), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.#keepToSite(window.webContents, site.id);
    window.once("ready-to-show", () => window.show());
    // Titled by the page and the site, so windows of two sites tell apart in the Window menu.
    window.on("page-title-updated", (event, title) => {
      event.preventDefault();
      window.setTitle(windowTitleOf(title, this.#sites.find(site.id)?.name ?? site.name));
    });
    window.on("close", () => {
      // Closing the last window quits the app, but on a Mac, where reopening it from the Dock opens it again.
      this.#sites.update(site.id, { bounds: window.getNormalBounds(), open: this.#quitting || this.#windows.size === 1 });
    });
    window.on("closed", () => {
      this.#windows.delete(site.id);
      this.#changed();
    });
    void window.loadURL(site.address);
    void this.#rename(site.id);
    this.#windows.set(site.id, window);
    this.#changed();
    return window;
  }

  /** Asks the site with `id` its name again, which its administrators can change, for the Sites menu. */
  async #rename(id: string): Promise<void> {
    const checked = await checkSite(this.#addressOf(id), net.fetch);
    if (typeof checked !== "string" && checked.name !== this.#sites.find(id)?.name) this.#sites.update(id, { name: checked.name });
  }

  #addressOf(id: string): string {
    return this.#sites.find(id)?.address ?? "";
  }

  #idOf(window: BrowserWindow): string | undefined {
    return this.#opened.get(window) ?? [...this.#windows].find(([, open]) => open === window)?.[0];
  }

  /**
   * Keeps `contents`, a window of the site with `id` or one its pages opened, on the site's own pages,
   * opening anything elsewhere outside the app, but for the site's Memberful site, which signing in with
   * Memberful, and connecting an account there, pass through, and the site's move to a custom domain,
   * which the window follows.
   */
  #keepToSite(contents: WebContents, id: string): void {
    const address = () => this.#addressOf(id);
    // The site the window passes through as someone signs in there, until it's back on its own site.
    let passingThrough: string | null = null;
    // The address the window's page is loading from, as the last redirect left it.
    let loading = "";

    contents.on("did-start-navigation", ({ url, isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) loading = url;
    });
    contents.on("will-navigate", (event) => {
      const destination = destinationOf(event.url, address(), passingThrough);
      if (destination === "window") return;
      event.preventDefault();
      if (destination !== "outside") return;
      void this.#leave(contents, id, event.url, (memberful) => {
        passingThrough = memberful;
      });
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame) return;
      passingThrough = passageOf(loading, event.url, address()) ?? passingThrough;
      const destination = destinationOf(event.url, address(), passingThrough);
      if (destination === "window") {
        loading = event.url;
        return;
      }
      event.preventDefault();
      if (destination === "outside") void shell.openExternal(event.url);
    });
    contents.on("did-navigate", (_event, url) => {
      if (URL.parse(url)?.origin === address()) passingThrough = null;
    });
    contents.setWindowOpenHandler(({ url }) => {
      const destination = destinationOf(url, address());
      if (destination === "window") return { action: "allow", overrideBrowserWindowOptions: { ...SMALLEST, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } } };
      if (destination === "outside") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (opened) => {
      this.#opened.set(opened, id);
      opened.once("closed", () => this.#opened.delete(opened));
      this.#keepToSite(opened.webContents, id);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-prevent-unload", (event) => {
      if (askToLeave(contents)) event.preventDefault();
      else this.#quitting = false;
    });
    contents.on("context-menu", (_event, params) => contextMenuOf(contents, params)?.popup());
    contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      const problem = isCertificateError(code) ? "?problem=certificate" : "";
      void contents.loadURL(`${pageAddress("unreachable.html")}${problem}#${encodeURIComponent(URL.parse(url)?.origin ?? address())}`);
    });
    contents.on("render-process-gone", (_event, { reason }) => {
      if (reason !== "clean-exit") contents.reload();
    });
  }

  /**
   * Opens `url` outside the app, unless it's where the site with `id` has moved, which the window follows,
   * or the sign-in at the site's Memberful site, where connecting an account there goes, which the window
   * passes through, as it tells `passThrough`.
   */
  async #leave(contents: WebContents, id: string, url: string, passThrough: (memberful: string) => void): Promise<void> {
    const { origin } = new URL(url);
    if (mayBeMoving(contents.getURL(), url)) {
      const site = await checkSite(this.#addressOf(id), net.fetch);
      if (typeof site !== "string" && site.address === origin) {
        this.#sites.update(id, site);
        await contents.loadURL(url);
        return;
      }
    }
    if (mayBeSigningIn(url) && (await memberfulSiteOf(this.#addressOf(id), redirectOf)) === origin) {
      passThrough(origin);
      await contents.loadURL(url);
      return;
    }
    await shell.openExternal(url);
  }

  #changed(): void {
    for (const listener of this.#listeners) listener();
  }
}

/**
 * Asks whether to leave a page that has changes it hasn't saved, as a browser does, since Electron would
 * otherwise keep it open without a word.
 */
function askToLeave(contents: WebContents): boolean {
  const window = BrowserWindow.fromWebContents(contents);
  const options = {
    type: "question" as const,
    message: "Leave this page?",
    detail: "Changes you made may not be saved.",
    buttons: ["Leave", "Stay"],
    defaultId: 0,
    cancelId: 1,
  };
  return (window ? dialog.showMessageBoxSync(window, options) : dialog.showMessageBoxSync(options)) === 0;
}

/**
 * Where asking for `url` redirects, through Chromium's network as the site's window would ask, but with
 * no site's cookies: the address its answer's Location gives, or null for an answer that doesn't redirect.
 */
function redirectOf(url: string, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: "manual", credentials: "omit" });
    const answer = (location: string | null) => {
      resolve(location);
      request.abort();
    };
    request.on("redirect", (_status, _method, location) => answer(location));
    request.on("response", () => answer(null));
    request.on("error", reject);
    signal.addEventListener("abort", () => {
      reject(signal.reason);
      request.abort();
    });
    request.end();
  });
}

/** A site's window's title: its page's, then the site's name, unless the page names it already. */
const windowTitleOf = (title: string, siteName: string) => (title.includes(siteName) ? title : `${title} · ${siteName}`);

/** `bounds`, where a window was, if any part of it is still on a screen, as one that's been unplugged isn't. */
function onScreen(bounds: Bounds | undefined): Bounds | object {
  if (bounds === undefined) return {};
  const shown = screen.getAllDisplays().some(({ workArea: area }) => bounds.x < area.x + area.width && area.x < bounds.x + bounds.width && bounds.y < area.y + area.height && area.y < bounds.y + bounds.height);
  return shown ? bounds : { width: bounds.width, height: bounds.height };
}
