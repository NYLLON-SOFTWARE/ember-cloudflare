import type { Page } from "@playwright/test";
import type { SiteBridge, SiteNotification } from "../src/site-bridge.ts";
import { fakeEmber, fakeMemberful } from "./fake-sites.ts";
import { expect, test, type App } from "./fixtures.ts";

// What a site's own pages hand the app through `window.emberDesktop` (src/preload/site.cts), as Ember's web
// app does: the notifications Ember's workspace socket sends them, which the app shows itself, since no
// push service reaches it, and how many conversations are unread, for the app's icon. And the sites'
// windows, which keep running out of sight once they're closed, to notify.

/** Hands the app `notification` from `page`, as Ember's web app does with each its workspace socket sends. */
const notify = (page: Page, notification: SiteNotification) =>
  page.evaluate((notification) => (window as unknown as { emberDesktop: SiteBridge }).emberDesktop.notify(notification), notification);

/** Tells the app from `page` how many conversations its site has unread, as Ember's web app does. */
const setBadge = (page: Page, count: number) => page.evaluate((count) => (window as unknown as { emberDesktop: SiteBridge }).emberDesktop.setBadge(count), count);

/**
 * Lists each notification the app shows rather than showing it, which CI's machines can't all do, and
 * says the system shows them, as Linux without a notification service doesn't.
 */
const keepNotifications = (app: App) =>
  app.electron.evaluate(({ Notification }) => {
    const shown: Electron.Notification[] = [];
    Object.assign(globalThis, { shown });
    Notification.isSupported = () => true;
    Notification.prototype.show = function (this: Electron.Notification) {
      shown.push(this);
    };
  });

/** The notifications the app has shown, oldest first. */
const shown = (app: App) => app.electron.evaluate(() => (globalThis as unknown as { shown: Electron.Notification[] }).shown.map(({ title, body }) => ({ title, body })));

/** Clicks the notification the app showed titled `title`. */
const click = (app: App, title: string) =>
  app.electron.evaluate((_electron, title) => void (globalThis as unknown as { shown: Electron.Notification[] }).shown.find((shown) => shown.title === title)!.emit("click"), title);

/** Notes the count on the app's icon, the Dock's or a Linux dock's, or the one drawn over the taskbar's on Windows, as each window's describes it. */
const keepBadge = (app: App) =>
  app.electron.evaluate(({ app, BrowserWindow }) => {
    const badge = { count: 0 };
    Object.assign(globalThis, { badge });
    app.setBadgeCount = (count) => {
      badge.count = count ?? 0;
      return true;
    };
    BrowserWindow.prototype.setOverlayIcon = (_image, description) => {
      badge.count = Number.parseInt(description) || 0;
    };
  });

/** The count on the app's icon. */
const badge = (app: App) => app.electron.evaluate(() => (globalThis as unknown as { badge: { count: number } }).badge.count);

test("shows a site's notifications once however many of its windows hand them over, and opens the page of one clicked", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await keepNotifications(app);
  const [opened] = await Promise.all([app.electron.waitForEvent("window"), page.evaluate(() => window.open("/rooms/3"))]);
  await opened.waitForLoadState("domcontentloaded");

  // Ember sends each of the site's windows the same notification, by the same id. A window's later
  // notifications reach the app after its earlier ones.
  const lunch = { id: "message:1", title: "Ada in #general", body: "Lunch?", path: "/rooms/2" };
  await notify(page, lunch);
  await notify(opened, lunch);
  await notify(opened, { id: "message:2", title: "Grace in #general", body: "On my way", path: "/rooms/1" });
  await notify(page, { id: "huddle:2:1", title: "Linus invited you to a huddle", body: "In #random", path: "/rooms/2" });
  await expect.poll(async () => (await shown(app)).map(({ title }) => title).sort()).toEqual(["Ada in #general", "Grace in #general", "Linus invited you to a huddle"]);

  // Clicking one shows the site's window, out of sight as it was, and has Ember open its page there.
  await page.evaluate(() => {
    const opening: string[] = [];
    Object.assign(window, { opening });
    (window as unknown as { emberDesktop: SiteBridge }).emberDesktop.onOpen((path) => opening.push(path));
  });
  await app.close("general · Fernwood");
  await click(app, "Ada in #general");
  await expect.poll(() => app.titles("showing")).toEqual(["general", "general · Fernwood"]);
  await expect.poll(() => page.evaluate(() => (window as unknown as { opening: string[] }).opening)).toEqual(["/rooms/2"]);

  // A page with nothing to open it with, as one that isn't Ember's workspace, goes there.
  await page.reload();
  await click(app, "Grace in #general");
  await expect(page).toHaveURL(`${fernwood.origin}/rooms/1`);

  // With another site added, each notification says which site it's from, and each site's are its own.
  await app.clickMenu("Sites", "Add Site…");
  const atBirchwood = await app.add(await app.electron.waitForEvent("window"), birchwood.origin);
  await notify(atBirchwood, lunch);
  await expect.poll(async () => (await shown(app)).at(-1)).toEqual({ title: "Ada in #general · Birchwood", body: "Lunch?" });
  expect(await shown(app)).toHaveLength(4);
});

test("takes nothing from a page the site's window passes through to sign in", async ({ app }) => {
  const [fernwood, memberful] = [await fakeEmber("Fernwood"), await fakeMemberful()];
  fernwood.memberful = memberful.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await keepNotifications(app);
  await keepBadge(app);

  await page.getByRole("link", { name: "Sign in with Memberful" }).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`^${memberful.origin}/oauth\\?`));
  await notify(page, { id: "message:1", title: "Sign in again", body: "Your password, please", path: "/" });
  await setBadge(page, 5);
  await page.waitForTimeout(500);
  expect([await shown(app), await badge(app)]).toEqual([[], 0]);

  // Back on the site, its pages are heard again.
  await page.getByRole("link", { name: "Allow" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");
  await notify(page, { id: "message:2", title: "Ada in #general", body: "Welcome back", path: "/" });
  await expect.poll(() => shown(app)).toEqual([{ title: "Ada in #general", body: "Welcome back" }]);
});

test("counts what every site has unread on the app's icon, each site's as the most any of its pages says", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  const atFernwood = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  const atBirchwood = await app.add(await app.electron.waitForEvent("window"), birchwood.origin);
  await keepBadge(app);
  const [opened] = await Promise.all([app.electron.waitForEvent("window"), atFernwood.evaluate(() => window.open("/rooms/3"))]);
  await opened.waitForLoadState("domcontentloaded");

  await setBadge(atFernwood, 2);
  await setBadge(opened, 3);
  await setBadge(atBirchwood, 1);
  await expect.poll(() => badge(app)).toBe(4);

  // A page that's moved on counts nothing until it says again, nor does one that's closed.
  await opened.reload();
  await expect.poll(() => badge(app)).toBe(3);
  await setBadge(opened, 5);
  await expect.poll(() => badge(app)).toBe(6);
  await app.close("general");
  await expect.poll(() => badge(app)).toBe(3);
  await setBadge(atFernwood, 0);
  await setBadge(atBirchwood, 0);
  await expect.poll(() => badge(app)).toBe(0);
});

test("keeps a site's window running out of sight as it's closed, to notify, and shows it as the app's opened again", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await keepNotifications(app);

  await app.close("general · Fernwood");
  expect([await app.titles("showing"), await app.titles("running")]).toEqual([[], ["general · Fernwood"]]);
  await notify(page, { id: "message:1", title: "Ada in #general", body: "Lunch?", path: "/rooms/2" });
  await expect.poll(() => shown(app)).toHaveLength(1);

  // Opening the app again, as from the Dock, the Start menu or a launcher, shows the window in front last.
  await app.electron.evaluate(({ app }) => void app.emit("second-instance"));
  await expect.poll(() => app.titles("showing")).toEqual(["general · Fernwood"]);
  if (process.platform === "darwin") {
    // As does clicking the app's icon in the Dock.
    await app.close("general · Fernwood");
    await app.electron.evaluate(({ app }) => void app.emit("activate", {}, false));
    await expect.poll(() => app.titles("showing")).toEqual(["general · Fernwood"]);
  }
});

test("keeps an icon in the tray on Windows and Linux, which shows the app, its menu showing each site or adding one", async ({ app }) => {
  test.skip(process.platform === "darwin", "A Mac's app keeps running in the Dock instead.");
  // The tray's icon and its menu, as the app lists its sites there.
  type Kept = { tray: { icon: Electron.Tray; menu: Electron.Menu } };
  await app.electron.evaluate(({ Tray }) => {
    const setContextMenu = Tray.prototype.setContextMenu;
    Tray.prototype.setContextMenu = function (this: Electron.Tray, menu) {
      Object.assign(globalThis, { tray: { icon: this, menu } });
      setContextMenu.call(this, menu);
    };
  });
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  await app.add(await app.electron.waitForEvent("window"), birchwood.origin);
  const menu = await app.electron.evaluate(() => (globalThis as unknown as Kept).tray.menu.items.map(({ label, type }) => (type === "separator" ? "—" : label)));
  expect(menu).toEqual(["Fernwood", "Birchwood", "—", "Add Site…", "—", "Quit Ember"]);
  const clickItem = (label: string) => app.electron.evaluate((_electron, label) => (globalThis as unknown as Kept).tray.menu.items.find((item) => item.label === label)?.click(), label);

  // Clicking the icon, once every window's closed, shows the one in front last, Birchwood's, as it was
  // added, once the system has put it in front.
  await expect.poll(() => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.getTitle())).toBe("general · Birchwood");
  await app.close("general · Fernwood");
  await app.close("general · Birchwood");
  await app.electron.evaluate(() => void (globalThis as unknown as Kept).tray.icon.emit("click"));
  await expect.poll(() => app.titles("showing")).toEqual(["general · Birchwood"]);

  // Its menu shows a site's window, or Add Site.
  await clickItem("Fernwood");
  await expect.poll(() => app.titles("showing")).toEqual(["general · Birchwood", "general · Fernwood"]);
  const [addSite] = await Promise.all([app.electron.waitForEvent("window"), clickItem("Add Site…")]);
  await expect(addSite).toHaveTitle("Add a Site");
});
