import { BrowserWindow, dialog, nativeTheme, screen, shell, type IpcMainEvent, type WebContents } from "electron";
import path from "node:path";
import { pageAddress } from "./app-pages.ts";
import { contextMenuOf } from "./context-menu.ts";
import { destinationOf, mayBeMoving, mayBeSigningIn, onwardPassageOf, passageOf } from "./navigation.ts";
import { OPEN } from "./site-bridge.ts";
import { checkSite, signsInAt } from "./site-check.ts";
import { fetchFollowing, redirectOf } from "./site-fetch.ts";
import { sessionOf } from "./site-session.ts";
import type { Bounds, Site, Sites } from "./sites.ts";

/** How large a site's window opens the first time, and how small it can be made. */
const FIRST_SIZE = { width: 1280, height: 860 };
const SMALLEST = { minWidth: 400, minHeight: 500 };

/**
 * How the sites' windows run their pages: as a browser tab would, sandboxed, apart from the app's code and
 * without Node, but for what the preload lets the site's own pages ask of the app (site-bridge.ts).
 */
const PAGES = { preload: path.join(import.meta.dirname, "preload", "site.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false };

/** Chromium's errors for a certificate it doesn't trust, from -200 to -299. */
const isCertificateError = (code: number) => code <= -200 && code > -300;

/** Chromium's error for a load that something else stopped, such as a newer one. */
const ABORTED = -3;

/** What a page moving somewhere the app asks the site about first tells the app as it asks. */
interface Leaving {
  /** Whether the page still wants to move: it hasn't moved again, nor its window closed, since. */
  stillWanted(): boolean;
  /** Lets the window pass through the site where someone signs in at the origin `signIn` until it's back on its own site. */
  passThrough(signIn: string): void;
}

/**
 * Each site's window, which opens the site's own Ember and keeps to it, as a browser tab would, goes out of
 * sight as it's closed, its pages still running to notify, until the app quits, and remembers where it was
 * and whether it was showing as the app quit; and the windows its pages open, which keep to the site too.
 */
export class SiteWindows {
  readonly #sites: Sites;
  readonly #windows = new Map<string, BrowserWindow>();
  /** The windows the sites' pages opened, each with the id of the site whose pages opened it. */
  readonly #opened = new Map<BrowserWindow, string>();
  readonly #listeners = new Set<() => void>();
  /** The id of the site whose window, or one its pages opened, was in front last. */
  #lastShown: string | null = null;
  #quitting = false;
  /** The ids of the sites whose own windows were showing as the app last began to quit, to show them again should someone stay. */
  #showingAtQuit = new Set<string>();

  constructor(sites: Sites) {
    this.#sites = sites;
  }

  /** Brings the site's window to the front, opening it if it isn't open, at its page at `path` where one's given. */
  show(site: Site, path?: string): void {
    const open = this.#windows.get(site.id);
    const window = open ?? this.#open(site, { path });
    if (open !== undefined && path !== undefined) openPage(open.webContents, site.address, path);
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  /** Opens the site's window out of sight, unless it's open, for its pages to notify and count what's unread. */
  start(site: Site): void {
    if (!this.#windows.has(site.id)) this.#open(site, { shown: false });
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

  /** The site whose own page, in one of its windows, sent `event`, or undefined for any other page, such as a site's its window passes through. */
  siteOfSender({ sender, senderFrame }: IpcMainEvent): Site | undefined {
    const site = this.siteOf(BrowserWindow.fromWebContents(sender));
    return site !== undefined && URL.parse(senderFrame?.url ?? "")?.origin === site.address ? site : undefined;
  }

  /** The site whose window, or one its pages opened, was in front last, unless it's been removed since. */
  lastShown(): Site | undefined {
    return this.#lastShown === null ? undefined : this.#sites.find(this.#lastShown);
  }

  /** Whether any of the app's windows is showing but the site with `id`'s, its own and those its pages opened. */
  anyShowingBut(id: string): boolean {
    return BrowserWindow.getAllWindows().some((window) => isShowing(window) && this.#idOf(window) !== id);
  }

  /**
   * Remembers, as the app quits, which sites are showing, in their own windows or ones their pages opened,
   * to show them again as it next starts, and lets each site's window close rather than go out of sight.
   */
  quitting(): void {
    this.#quitting = true;
    this.#showingAtQuit = new Set([...this.#windows].filter(([, window]) => isShowing(window)).map(([id]) => id));
    for (const id of this.#windows.keys()) this.#sites.update(id, { open: this.#showing(id) });
  }

  /** Calls `listener` whenever a window opens or closes. */
  onChange(listener: () => void): void {
    this.#listeners.add(listener);
  }

  /** Opens the site's window, at its page at `path` or its first, and shows it unless it's not `shown`. */
  #open(site: Site, { path, shown = true }: { path?: string; shown?: boolean }): BrowserWindow {
    const window = new BrowserWindow({
      ...FIRST_SIZE,
      ...onScreen(site.bounds),
      ...SMALLEST,
      title: site.name,
      show: false,
      // Its page says it's out of sight, as Ember asks to tell whether someone's there, only where
      // Chromium doesn't draw it until it's shown.
      paintWhenInitiallyHidden: shown,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#171717" : "#ffffff",
      webPreferences: { ...PAGES, session: sessionOf(site.id, () => this.#addressOf(site.id)) },
    });
    this.#keepToSite(window.webContents, site.id);
    const showOnceReady = () => window.show();
    if (shown) window.once("ready-to-show", showOnceReady);
    // Titled by the page and the site, so windows of two sites tell apart in the Window menu.
    window.on("page-title-updated", (event, title) => {
      event.preventDefault();
      window.setTitle(windowTitleOf(title, this.#sites.find(site.id)?.name ?? site.name));
    });
    window.on("focus", () => this.#inFront(window, site.id));
    window.on("close", (event) => {
      this.#sites.update(site.id, { bounds: window.getNormalBounds() });
      if (this.#quitting) return;
      event.preventDefault();
      // Shown at once, as asked for, it can close before its page is ready to show, and stays out of sight as it is.
      window.off("ready-to-show", showOnceReady);
      hide(window);
    });
    window.on("hide", () => this.#changed());
    window.on("show", () => this.#changed());
    // Windows ends its session without the app quitting first.
    window.on("session-end", () => this.quitting());
    window.on("closed", () => {
      this.#windows.delete(site.id);
      this.#changed();
      // A quit someone stayed for, on a page with changes it hadn't saved, closed it anyway.
      const stayed = this.#quitting ? undefined : this.#sites.find(site.id);
      if (stayed) this.#reopen(stayed);
    });
    void window.loadURL(path === undefined ? site.address : new URL(path, site.address).href);
    void this.#rename(site.id);
    this.#windows.set(site.id, window);
    this.#changed();
    return window;
  }

  /** Whether the site with `id` is showing, in its own window or one its pages opened, which go out of sight only as they close. */
  #showing(id: string): boolean {
    const own = this.#windows.get(id);
    return (own !== undefined && isShowing(own)) || [...this.#opened.values()].includes(id);
  }

  /** Asks the site with `id` its name again, which its administrators can change, for the Sites menu. */
  async #rename(id: string): Promise<void> {
    const checked = await checkSite(this.#addressOf(id), fetchFollowing);
    if (typeof checked !== "string" && checked.name !== this.#sites.find(id)?.name) this.#sites.update(id, { name: checked.name });
  }

  /**
   * Notes the site with `id` as the one in front last, as `window`, one of its windows, comes to the front,
   * unless the window is out of sight, as one a system without a window manager focuses after hiding it.
   */
  #inFront(window: BrowserWindow, id: string): void {
    if (isShowing(window)) this.#lastShown = id;
  }

  #addressOf(id: string): string {
    return this.#sites.find(id)?.address ?? "";
  }

  #idOf(window: BrowserWindow): string | undefined {
    return this.#opened.get(window) ?? [...this.#windows].find(([, open]) => open === window)?.[0];
  }

  /**
   * Keeps `contents`, a window of the site with `id` or one its pages opened, on the site's own pages,
   * opening anything elsewhere outside the app, but for the site's Memberful site or single sign-on
   * provider, or the custom domain one sends them on to, which signing in with Memberful or SSO, and
   * connecting an account there, pass through, and the site's move to another address, a custom domain its
   * pages move to or one its server redirects them to, which the window follows.
   */
  #keepToSite(contents: WebContents, id: string): void {
    const address = () => this.#addressOf(id);
    // The site the window passes through as someone signs in there, until it's back on its own site.
    let passingThrough: string | null = null;
    // The address the window's page is loading from, as the last redirect left it.
    let loading = "";
    // How many times the window's page has moved, a room's link in the same page included, for a move the
    // app asks the site about first to tell whether the page has moved again since.
    let moves = 0;

    contents.on("did-start-navigation", ({ url, isMainFrame, isSameDocument }) => {
      if (!isMainFrame) return;
      moves++;
      if (!isSameDocument) loading = url;
    });
    // Leaves the site's page at `from` for `url`, elsewhere, as `#leave` says, once the site has said where it is.
    const leave = (from: string, url: string) => {
      // Its move has started already, so `moves` counts it.
      const asked = moves;
      void this.#leave(contents, id, from, url, {
        stillWanted: () => !contents.isDestroyed() && moves === asked,
        passThrough: (signIn) => {
          passingThrough = signIn;
        },
      });
    };

    contents.on("will-navigate", (event) => {
      const destination = destinationOf(event.url, address(), passingThrough);
      if (destination === "window") return;
      event.preventDefault();
      if (destination === "outside") leave(contents.getURL(), event.url);
    });
    contents.on("will-redirect", (event) => {
      if (!event.isMainFrame) return;
      passingThrough = passageOf(loading, event.url, address()) ?? onwardPassageOf(loading, event.url, passingThrough) ?? passingThrough;
      const destination = destinationOf(event.url, address(), passingThrough);
      if (destination === "window") {
        loading = event.url;
        return;
      }
      event.preventDefault();
      if (destination === "outside") leave(loading, event.url);
    });
    contents.on("did-navigate", (_event, url) => {
      if (URL.parse(url)?.origin === address()) passingThrough = null;
    });
    contents.setWindowOpenHandler(({ url }) => {
      const destination = destinationOf(url, address());
      // Its window stays open as its opener's closes, as a browser's would, to ask before it leaves changes of its own.
      if (destination === "window") return { action: "allow", outlivesOpener: true, overrideBrowserWindowOptions: { ...SMALLEST, webPreferences: PAGES } };
      if (destination === "outside") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (opened) => {
      this.#opened.set(opened, id);
      opened.on("focus", () => this.#inFront(opened, id));
      opened.once("closed", () => this.#opened.delete(opened));
      this.#keepToSite(opened.webContents, id);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
    contents.on("will-prevent-unload", (event) => {
      if (askToLeave(contents)) event.preventDefault();
      else this.#stay();
    });
    contents.on("context-menu", (_event, params) => contextMenuOf(contents, params)?.popup());
    contents.on("did-fail-load", (_event, code, _description, url, isMainFrame) => {
      if (!isMainFrame || code === ABORTED) return;
      // Trying again opens the site, where what failed elsewhere starts again, as signing in at its Memberful site or provider does.
      const query = new URLSearchParams({ site: address(), ...(isCertificateError(code) ? { problem: "certificate" } : {}) });
      void contents.loadURL(`${pageAddress("unreachable.html")}?${query}#${encodeURIComponent(URL.parse(url)?.origin ?? address())}`);
    });
    contents.on("render-process-gone", (_event, { reason }) => {
      if (reason !== "clean-exit") contents.reload();
    });
  }

  /**
   * Opens `url`, where the page at `from` is going, outside the app, unless it's where the site with `id`
   * has moved, which the window follows, or the sign-in at the site's Memberful site or single sign-on
   * provider, where connecting an account there goes, which the window passes through, as it tells
   * `leaving`. Should the page move again before the site answers, or its window close, the move is
   * dropped, as a browser drops a page it was opening once another is asked for.
   */
  async #leave(contents: WebContents, id: string, from: string, url: string, leaving: Leaving): Promise<void> {
    const { origin } = new URL(url);
    if (mayBeMoving(from, url)) {
      const site = await checkSite(this.#addressOf(id), fetchFollowing);
      if (!leaving.stillWanted()) return;
      if (typeof site !== "string" && site.address === origin) {
        this.#sites.update(id, site);
        void contents.loadURL(url);
        return;
      }
    }
    if (mayBeSigningIn(url)) {
      const signsInThere = await signsInAt(this.#addressOf(id), origin, redirectOf);
      if (!leaving.stillWanted()) return;
      if (signsInThere) {
        leaving.passThrough(origin);
        void contents.loadURL(url);
        return;
      }
    }
    await shell.openExternal(url);
  }

  /**
   * Keeps the app running as someone stays on a page with changes it hasn't saved, should it be quitting,
   * with every site's window: those the quit closed already open again, as the rest will as they close.
   */
  #stay(): void {
    this.#quitting = false;
    for (const site of this.#sites.list()) if (!this.#windows.has(site.id)) this.#reopen(site);
  }

  /** Opens the site's window again, as a quit someone stayed for closed it: showing, if it was, or out of sight. */
  #reopen(site: Site): void {
    this.#open(site, { shown: this.#showingAtQuit.has(site.id) });
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
  // A site's window that's out of sight, as the app quits, shows the page it asks about.
  if (window && !isShowing(window)) window.show();
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
 * Opens the page at `path` of the site at `address` in `contents`: in place, as Ember opens it, while the
 * window is on the site, or by loading it, while it's on a site it passes through or the app's page saying
 * the site can't be reached.
 */
function openPage(contents: WebContents, address: string, path: string): void {
  if (URL.parse(contents.getURL())?.origin === address) contents.send(OPEN, path);
  else void contents.loadURL(new URL(path, address).href);
}

/** Whether `window` is showing, minimized as it may be. */
export const isShowing = (window: BrowserWindow) => window.isVisible() || window.isMinimized();

/** Puts `window` out of sight, leaving full screen first on a Mac, where its space would otherwise stay, black. */
function hide(window: BrowserWindow): void {
  if (process.platform !== "darwin" || !window.isFullScreen()) return window.hide();
  window.once("leave-full-screen", () => window.hide());
  window.setFullScreen(false);
}

/** A site's window's title: its page's, then the site's name, unless the page names it already. */
const windowTitleOf = (title: string, siteName: string) => (title.includes(siteName) ? title : `${title} · ${siteName}`);

/** `bounds`, where a window was, if any part of it is still on a screen, as one that's been unplugged isn't. */
function onScreen(bounds: Bounds | undefined): Bounds | object {
  if (bounds === undefined) return {};
  const shown = screen.getAllDisplays().some(({ workArea: area }) => bounds.x < area.x + area.width && area.x < bounds.x + bounds.width && bounds.y < area.y + area.height && area.y < bounds.y + bounds.height);
  return shown ? bounds : { width: bounds.width, height: bounds.height };
}
