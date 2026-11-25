import { Notification } from "electron";
import type { SiteNotification } from "./site-bridge.ts";
import type { Site } from "./sites.ts";

/** How many of the latest notifications the app keeps, to show each once and to hear when one is clicked. */
const KEPT = 100;

/** A notification the app has shown. */
interface Shown {
  /** The id of the site it's from. */
  site: string;
  /** Its id, the same from each of the site's windows. */
  id: string;
  /** Kept from the garbage collector, which would take its clicks with it. */
  notification: Notification;
}

/**
 * Shows the notifications each site's pages hand the app, as the system's, once each however many of the
 * site's windows hand it over, and calls `open` with the site's id and the page of each the person clicks.
 */
export class SiteNotifications {
  readonly #open: (site: string, path: string) => void;
  /** The latest notifications shown, oldest first. */
  readonly #shown: Shown[] = [];

  constructor(open: (site: string, path: string) => void) {
    this.#open = open;
  }

  /** Shows `notification` from `site`, naming the site after its title where `named`, as where the app has several, unless it's shown already. */
  show(site: Site, { id, title, body, path }: SiteNotification, named: boolean): void {
    if (!Notification.isSupported() || this.#shown.some((shown) => shown.site === site.id && shown.id === id)) return;
    const notification = new Notification({ title: named ? `${title} · ${site.name}` : title, body });
    notification.on("click", () => {
      notification.close();
      this.#open(site.id, path);
    });
    this.#shown.push({ site: site.id, id, notification });
    if (this.#shown.length > KEPT) this.#shown.shift();
    notification.show();
  }
}
