import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import path from "node:path";
import type { AddSiteOutcome } from "./add-site-bridge.ts";
import { AddSiteWindow } from "./add-site-window.ts";
import { AppBadge } from "./app-badge.ts";
import { registerPagesScheme } from "./app-pages.ts";
import { applicationMenu } from "./menu.ts";
import { siteAddressOf } from "./site-address.ts";
import { countOf, notificationOf, NOTIFY, SET_BADGE } from "./site-bridge.ts";
import { checkSite } from "./site-check.ts";
import { fetchFollowing } from "./site-fetch.ts";
import { SiteNotifications } from "./site-notifications.ts";
import { forgetSession, stillForgetting } from "./site-session.ts";
import { isShowing, SiteWindows } from "./site-window.ts";
import { Sites, type Site } from "./sites.ts";
import { AppTray } from "./tray.ts";

// Ember's desktop app: a window for each Ember site added to it, opening the site's own Ember, as a
// browser tab would, with what a tab can't have: a place in the Dock or taskbar, its notifications and
// unread count while the app runs, closed windows and all, menus, and windows of its own.

// The app's tests keep its sites in a folder of their own.
if (process.env.EMBER_DESKTOP_USER_DATA) app.setPath("userData", process.env.EMBER_DESKTOP_USER_DATA);

// Windows shows the app's notifications as those of the app its installer's shortcut names by the app's id
// (electron-builder.yml's appId), or of Electron itself while it runs from this folder.
if (process.platform === "win32") app.setAppUserModelId(app.isPackaged ? "com.nyllon.ember" : process.execPath);

registerPagesScheme();

// One copy of the app runs at a time: opening it again brings the one running to the front.
if (app.requestSingleInstanceLock()) void app.whenReady().then(start);
else app.quit();

function start(): void {
  const sites = new Sites(path.join(app.getPath("userData"), "sites.json"));
  const windows = new SiteWindows(sites);
  const addSiteWindow = new AddSiteWindow(addSite);
  const notifications = new SiteNotifications((id, path) => {
    const site = sites.find(id);
    if (site) windows.show(site, path);
  });
  const badge = new AppBadge();
  // A Mac's app keeps running in the Dock instead.
  const tray = process.platform === "darwin" ? null : new AppTray({ showApp, showSite: (site) => windows.show(site), addSite: () => addSiteWindow.show() });

  // What a site's own pages hand the app through their preload, and nothing from any other page.
  ipcMain.on(NOTIFY, (event, value: unknown) => {
    const [site, notification] = [windows.siteOfSender(event), notificationOf(value)];
    if (site && notification) notifications.show(site, notification, sites.list().length > 1);
  });
  ipcMain.on(SET_BADGE, (event, value: unknown) => {
    const [site, count] = [windows.siteOfSender(event), countOf(value)];
    if (site && count !== null) badge.count(event.sender, site.id, count);
  });

  /** Adds the site at the address typed, unless it's been added already, and opens its window. */
  async function addSite(typed: string): Promise<AddSiteOutcome> {
    const address = siteAddressOf(typed);
    if (address === null) return { problem: "address" };
    const checked = await checkSite(address, fetchFollowing);
    if (typeof checked === "string") return { problem: checked };
    windows.show(sites.at(checked.address) ?? sites.add(checked.address, checked.name));
    return { added: true };
  }

  async function removeSite(site: Site): Promise<void> {
    const { response } = await dialog.showMessageBox({
      type: "question",
      message: `Remove ${site.name}?`,
      detail: `The app forgets ${new URL(site.address).host} and your sign-in there. You can add it again.`,
      buttons: ["Remove", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return;
    sites.remove(site.id);
    // Where the site's windows are the only ones showing, another site's shows before they close, or Add
    // Site once there's none, rather than the app being left out of sight, or quitting.
    if (!windows.anyShowingBut(site.id)) showSite(sites.list()[0]);
    // Closed first, so that the site's pages can't keep anything in its session as it's forgotten.
    windows.close(site.id);
    await forgetSession(site.id);
  }

  /**
   * Opens every site's window, for each to notify, showing those that were showing as the app last quit,
   * or the first site's, or Add Site while there's none.
   */
  function startSites(): void {
    const listed = sites.list();
    const shown = listed.some((site) => site.open) ? listed.filter((site) => site.open) : listed.slice(0, 1);
    if (shown.length === 0) addSiteWindow.show();
    for (const site of listed) {
      if (shown.includes(site)) windows.show(site);
      else windows.start(site);
    }
  }

  /** Shows `site`'s window, or Add Site while there's no site. */
  function showSite(site: Site | undefined): void {
    if (site) windows.show(site);
    else addSiteWindow.show();
  }

  /** Brings the app to the front: the window in front last, where any's showing, or else the window of the site that was. */
  function showApp(): void {
    const focused = BrowserWindow.getFocusedWindow();
    const window = focused !== null && isShowing(focused) ? focused : BrowserWindow.getAllWindows().find(isShowing);
    if (window === undefined) return showSite(windows.lastShown() ?? sites.list()[0]);
    if (window.isMinimized()) window.restore();
    window.focus();
  }

  const showMenu = () => {
    const actions = { addSite: () => addSiteWindow.show(), showSite: (site: Site) => windows.show(site), removeSite: (site: Site) => void removeSite(site) };
    Menu.setApplicationMenu(applicationMenu(sites.list(), windows.siteOf(BrowserWindow.getFocusedWindow()), actions));
  };
  sites.onChange(showMenu);
  windows.onChange(showMenu);
  if (tray) {
    tray.list(sites.list());
    sites.onChange(() => tray.list(sites.list()));
  }
  app.on("browser-window-focus", showMenu);
  showMenu();

  app.setAboutPanelOptions({ applicationName: "Ember", applicationVersion: app.getVersion(), copyright: "Copyright © 2026 NYLLON LLC" });
  app.on("second-instance", showApp);
  // As a Mac's Dock icon is clicked, or the app opened again.
  app.on("activate", (_event, hasVisibleWindows) => {
    if (!hasVisibleWindows) showApp();
  });
  app.on("before-quit", () => windows.quitting());
  app.on("will-quit", (event) => {
    // A site just removed is forgotten before the app quits, rather than left half forgotten.
    const forgetting = stillForgetting();
    if (forgetting === null) return;
    event.preventDefault();
    void forgetting.then(() => app.quit());
  });
  // Once every window has closed, as Add Site's does where there's no site, on Windows and Linux.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  startSites();
}
