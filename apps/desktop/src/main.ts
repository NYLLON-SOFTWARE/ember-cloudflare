import { app, BrowserWindow, dialog, Menu, net } from "electron";
import path from "node:path";
import type { AddSiteOutcome } from "./add-site-bridge.ts";
import { AddSiteWindow } from "./add-site-window.ts";
import { registerPagesScheme } from "./app-pages.ts";
import { applicationMenu } from "./menu.ts";
import { siteAddressOf } from "./site-address.ts";
import { checkSite } from "./site-check.ts";
import { forgetSession, stillForgetting } from "./site-session.ts";
import { SiteWindows } from "./site-window.ts";
import { Sites, type Site } from "./sites.ts";

// Ember's desktop app: a window for each Ember site added to it, opening the site's own Ember, as a
// browser tab would, with what a tab can't have: a place in the Dock or taskbar, menus, and windows of
// its own.

// The app's tests keep its sites in a folder of their own.
if (process.env.EMBER_DESKTOP_USER_DATA) app.setPath("userData", process.env.EMBER_DESKTOP_USER_DATA);

registerPagesScheme();

// One copy of the app runs at a time: opening it again brings the one running to the front.
if (app.requestSingleInstanceLock()) void app.whenReady().then(start);
else app.quit();

function start(): void {
  const sites = new Sites(path.join(app.getPath("userData"), "sites.json"));
  const windows = new SiteWindows(sites);
  const addSiteWindow = new AddSiteWindow(addSite);

  /** Adds the site at the address typed, unless it's been added already, and opens its window. */
  async function addSite(typed: string): Promise<AddSiteOutcome> {
    const address = siteAddressOf(typed);
    if (address === null) return { problem: "address" };
    const checked = await checkSite(address, net.fetch);
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
    // Where the site's windows are the only ones, another site's opens before they close, or Add Site once
    // there's none, since closing the last window quits the app.
    if (!windows.anyOpenBut(site.id)) showSites();
    // Closed first, so that the site's pages can't keep anything in its session as it's forgotten.
    windows.close(site.id);
    await forgetSession(site.id);
  }

  /** Opens the windows that were open as the app last quit, or the first site's, or Add Site while there's none. */
  function showSites(): void {
    const reopened = sites.list().filter((site) => site.open);
    const shown = reopened.length > 0 ? reopened : sites.list().slice(0, 1);
    if (shown.length === 0) addSiteWindow.show();
    for (const site of shown) windows.show(site);
  }

  const showMenu = () => {
    const actions = { addSite: () => addSiteWindow.show(), showSite: (site: Site) => windows.show(site), removeSite: (site: Site) => void removeSite(site) };
    Menu.setApplicationMenu(applicationMenu(sites.list(), windows.siteOf(BrowserWindow.getFocusedWindow()), actions));
  };
  sites.onChange(showMenu);
  windows.onChange(showMenu);
  app.on("browser-window-focus", showMenu);
  showMenu();

  app.setAboutPanelOptions({ applicationName: "Ember", applicationVersion: app.getVersion(), copyright: "Copyright © 2026 NYLLON LLC" });
  app.on("second-instance", () => {
    const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (window === undefined) return showSites();
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) showSites();
  });
  app.on("before-quit", () => windows.quitting());
  app.on("will-quit", (event) => {
    // A site just removed is forgotten before the app quits, rather than left half forgotten.
    const forgetting = stillForgetting();
    if (forgetting === null) return;
    event.preventDefault();
    void forgetting.then(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  showSites();
}
