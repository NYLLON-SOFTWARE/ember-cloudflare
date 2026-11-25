import { app, BrowserWindow, nativeImage, type WebContents } from "electron";
import { BADGE_PIXELS, badgePixels } from "./badge-image.ts";
import { UnreadCounts } from "./unread-counts.ts";

const isWindows = process.platform === "win32";

/**
 * The count on the app's icon: how many conversations every site has unread, as its pages say, on the
 * Dock's icon, or a Linux dock's, and drawn over the taskbar's on Windows, which has no count of its own.
 */
export class AppBadge {
  readonly #counts = new UnreadCounts<WebContents>();
  /** The pages that have said how many are unread, whose leaving the badge hears. */
  readonly #heard = new WeakSet<WebContents>();

  constructor() {
    // Windows shows the count over the icon of whichever of the app's windows set it last, which a window
    // that was out of sight can't have, so each window sets it as it shows.
    if (isWindows) app.on("browser-window-created", (_event, window) => window.on("show", () => overlay(window, this.#counts.total())));
  }

  /** Counts `count` as what `page`, a page of the site with id `site`, has unread, until it says otherwise, leaves or closes. */
  count(page: WebContents, site: string, count: number): void {
    if (!this.#heard.has(page)) {
      this.#heard.add(page);
      page.on("did-navigate", () => this.#change(() => this.#counts.drop(page)));
      page.once("destroyed", () => this.#change(() => this.#counts.drop(page)));
    }
    this.#change(() => this.#counts.set(page, site, count));
  }

  #change(change: () => void): void {
    const before = this.#counts.total();
    change();
    const total = this.#counts.total();
    if (total === before) return;
    if (!isWindows) app.setBadgeCount(total);
    else for (const window of BrowserWindow.getAllWindows()) overlay(window, total);
  }
}

/** Draws `total` over the taskbar's icon for `window`, or clears it at 0. */
function overlay(window: BrowserWindow, total: number): void {
  if (window.isDestroyed()) return;
  if (total === 0) return window.setOverlayIcon(null, "");
  const image = nativeImage.createFromBitmap(badgePixels(total), { width: BADGE_PIXELS, height: BADGE_PIXELS, scaleFactor: 2 });
  window.setOverlayIcon(image, `${total} unread`);
}
