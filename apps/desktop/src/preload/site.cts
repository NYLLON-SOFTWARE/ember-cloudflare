// What a site's pages may ask of the app (site-bridge.ts): showing a notification, the count on the app's
// icon, and opening each notification the person clicks. The app takes them only from the site's own
// pages, not from a site a window passes through as someone signs in. Electron's sandbox runs preloads
// as CommonJS.
import electron = require("electron");
import type { SiteBridge } from "../site-bridge.ts";

// As in site-bridge.ts, which a sandboxed preload can't import.
const NOTIFY = "site:notify";
const SET_BADGE = "site:set-badge";
const OPEN = "site:open";

/** What the page opens a clicked notification's page with. */
const openers = new Set<(path: string) => void>();

electron.ipcRenderer.on(OPEN, (_event, path: string) => {
  // A page that isn't Ember's workspace, such as its sign-in, has nothing to open it with, so it goes there.
  if (openers.size === 0) return location.assign(path);
  for (const open of openers) open(path);
});

const bridge: SiteBridge = {
  notify: (notification) => electron.ipcRenderer.send(NOTIFY, notification),
  setBadge: (count) => electron.ipcRenderer.send(SET_BADGE, count),
  onOpen(open) {
    openers.add(open);
    return () => void openers.delete(open);
  },
};

electron.contextBridge.exposeInMainWorld("emberDesktop", bridge);
