import { BrowserWindow, Menu, shell, type BaseWindow, type MenuItemConstructorOptions } from "electron";
import type { Site } from "./sites.ts";

/** What the app's menus do that's its own. */
export interface MenuActions {
  addSite(): void;
  showSite(site: Site): void;
  removeSite(site: Site): void;
}

const HELP = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare/tree/main/apps/desktop#readme";

const isMac = process.platform === "darwin";

/**
 * The app's menus: a desktop app's own, for a browser's Reload, zoom, Back and Forward, and Sites, which
 * lists `sites` with ⌘1 to ⌘9, or Ctrl, `shown` being the one whose window is in front.
 */
export function applicationMenu(sites: readonly Site[], shown: Site | undefined, actions: MenuActions): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    { label: "File", submenu: [{ role: "close" }, ...(isMac ? [] : [{ type: "separator" as const }, { role: "quit" as const }])] },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "History",
      submenu: [
        { label: "Back", accelerator: isMac ? "Cmd+[" : "Alt+Left", click: (_item, window) => goBack(window) },
        { label: "Forward", accelerator: isMac ? "Cmd+]" : "Alt+Right", click: (_item, window) => goForward(window) },
      ],
    },
    {
      label: "Sites",
      submenu: [
        ...sites.map((site, index): MenuItemConstructorOptions => ({
          label: labelOf(site, sites),
          type: "checkbox",
          checked: site.id === shown?.id,
          accelerator: index < 9 ? `CmdOrCtrl+${index + 1}` : undefined,
          click: () => actions.showSite(site),
        })),
        ...(sites.length > 0 ? [{ type: "separator" as const }] : []),
        { label: "Add Site…", click: () => actions.addSite() },
        { label: shown ? `Remove ${labelOf(shown, sites)}…` : "Remove Site…", enabled: shown !== undefined, click: () => shown && actions.removeSite(shown) },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "Ember Desktop Help", click: () => void shell.openExternal(HELP) }] },
  ];
  return Menu.buildFromTemplate(template);
}

/** `site`'s name, with its address where another of `sites` has the same name. */
export function labelOf(site: Site, sites: readonly Site[]): string {
  const named = sites.filter(({ name }) => name === site.name);
  return named.length > 1 ? `${site.name} (${new URL(site.address).host})` : site.name;
}

const historyOf = (window: BaseWindow | undefined) => (window instanceof BrowserWindow ? window.webContents.navigationHistory : null);

/** Goes back a page in `window`, where it can. */
function goBack(window: BaseWindow | undefined): void {
  const history = historyOf(window);
  if (history?.canGoBack()) history.goBack();
}

/** Goes forward a page in `window`, where it can. */
function goForward(window: BaseWindow | undefined): void {
  const history = historyOf(window);
  if (history?.canGoForward()) history.goForward();
}
