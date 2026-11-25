import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from "electron";
import path from "node:path";
import { labelOf } from "./menu.ts";
import type { Site } from "./sites.ts";

/** Ember's flame, which the app's own pages show too. */
const FLAME = path.join(import.meta.dirname, "pages", "ember-icon.png");

/** What the tray's icon and its menu do. */
export interface TrayActions {
  /** Brings the app's windows back, as clicking the icon does. */
  showApp(): void;
  showSite(site: Site): void;
  addSite(): void;
}

/**
 * The app's icon in the notification area on Windows, or the tray of a Linux desktop, where the app keeps
 * running, to notify, once its windows are closed: clicking it brings them back, and its menu opens each
 * site's window, adds a site, or quits the app. A Mac's app keeps running in the Dock instead.
 */
export class AppTray {
  readonly #tray = new Tray(trayIcon());
  readonly #actions: TrayActions;

  constructor(actions: TrayActions) {
    this.#actions = actions;
    this.#tray.setToolTip("Ember");
    this.#tray.on("click", () => actions.showApp());
  }

  /** Lists `sites` in the icon's menu. */
  list(sites: readonly Site[]): void {
    const template: MenuItemConstructorOptions[] = [
      ...sites.map((site): MenuItemConstructorOptions => ({ label: labelOf(site, sites), click: () => this.#actions.showSite(site) })),
      ...(sites.length > 0 ? [{ type: "separator" as const }] : []),
      { label: "Add Site…", click: () => this.#actions.addSite() },
      { type: "separator" },
      { label: "Quit Ember", role: "quit" },
    ];
    this.#tray.setContextMenu(Menu.buildFromTemplate(template));
  }
}

/**
 * The flame at the size Windows shows in its notification area, 16 points, at each of the scales a screen
 * may have, or at 32 pixels for a Linux desktop to scale to its tray.
 */
function trayIcon(): NativeImage {
  const flame = nativeImage.createFromPath(FLAME);
  if (process.platform !== "win32") return flame.resize({ width: 32, height: 32, quality: "best" });
  const icon = nativeImage.createEmpty();
  for (const scaleFactor of [1, 1.25, 1.5, 2]) {
    const size = Math.round(16 * scaleFactor);
    icon.addRepresentation({ scaleFactor, buffer: flame.resize({ width: size, height: size, quality: "best" }).toPNG() });
  }
  return icon;
}
