import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeElsewhere, fakeEmber, fakeEndless, fakeMemberful, fakeRedirect } from "./fake-sites.ts";
import { expect, test } from "./fixtures.ts";

// When the app keeps a page where it is, opening a link outside or nowhere, Playwright, having seen the
// page asked to leave, waits for it to: after the click, unless told `noWaitAfter`; before the page's next
// action, unless it's `force`d; and in `toHaveURL`, so these tests read the page's address as it is.

test("asks for a site on its first start, says why it can't add one, and opens an Ember site in a window of its own", async ({ app }) => {
  const [fernwood, blog] = [await fakeEmber("Fernwood"), await fakeElsewhere()];
  const addSite = await app.electron.firstWindow();
  await expect(addSite).toHaveTitle("Add a Site");
  await expect(addSite.getByLabel("Site address")).toBeFocused();

  const problem = addSite.getByRole("alert");
  await addSite.getByRole("button", { name: "Add site" }).click();
  await expect(problem).toHaveText("Type the address you open Ember at, such as chat.example.com.");
  await addSite.getByLabel("Site address").fill("127.0.0.1:9");
  await addSite.getByRole("button", { name: "Add site" }).click();
  await expect(problem).toHaveText("Couldn't reach 127.0.0.1:9. Check the address, and that you're online.");
  await addSite.getByLabel("Site address").fill(blog.origin);
  await addSite.getByRole("button", { name: "Add site" }).click();
  await expect(problem).toHaveText(`${new URL(blog.origin).host} isn't an Ember site. Check the address you open Ember at in your browser.`);
  await expect(addSite.getByLabel("Site address")).toHaveAttribute("aria-invalid", "true");

  // Typed without its scheme, as the address bar shows it, from a page of the site.
  const page = await app.add(addSite, `${new URL(fernwood.origin).host}/rooms/1`);
  await expect(page.getByRole("heading")).toHaveText("Signed out at Fernwood");
  expect(page.url()).toBe(`${fernwood.origin}/`);
  await expect.poll(() => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()))).toEqual(["general · Fernwood"]);
  expect(addSite.isClosed()).toBe(true);
  expect(app.sites()).toMatchObject([{ address: fernwood.origin, name: "Fernwood" }]);

  const sitesMenu = await app.electron.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.find((item) => item.label === "Sites")?.submenu?.items.map(({ label, accelerator, checked }) => ({ label, accelerator, checked })));
  expect(sitesMenu).toEqual([
    { label: "Fernwood", accelerator: "CmdOrCtrl+1", checked: true },
    { label: "", accelerator: null, checked: false },
    { label: "Add Site…", accelerator: null, checked: false },
    { label: "Remove Fernwood…", accelerator: null, checked: false },
  ]);
});

test("adds a site at the address its own redirects to, as a bare domain's do to its www", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const bare = await fakeRedirect(fernwood.origin);
  const page = await app.add(await app.electron.firstWindow(), bare.origin);
  await expect(page.getByRole("heading")).toHaveText("Signed out at Fernwood");
  expect(page.url()).toBe(`${fernwood.origin}/`);
  expect(app.sites()).toMatchObject([{ address: fernwood.origin, name: "Fernwood" }]);
  expect(await app.openedOutside()).toEqual([]);
});

test("stops reading a site's answer once it can't be Ember's, however much more the site sends", async ({ app }) => {
  const addSite = await app.electron.firstWindow();
  for (const status of [500, 200]) {
    const endless = await fakeEndless(status);
    await addSite.getByLabel("Site address").fill(endless.origin);
    await addSite.getByRole("button", { name: "Add site" }).click();
    // Long before the app would stop waiting for the site.
    await expect(addSite.getByRole("alert")).toHaveText(`${new URL(endless.origin).host} isn't an Ember site. Check the address you open Ember at in your browser.`);
    await expect.poll(() => endless.answering).toBe(0);
  }
});

test("keeps each site's sign-in apart, and opens the windows that were open as it quit, where they were", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  const atFernwood = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  const atBirchwood = await app.add(await app.electron.waitForEvent("window"), birchwood.origin);

  await atFernwood.goto(`${fernwood.origin}/sign-in`);
  await expect(atFernwood.getByRole("heading")).toHaveText("Signed in at Fernwood");
  await atBirchwood.reload();
  await expect(atBirchwood.getByRole("heading")).toHaveText("Signed out at Birchwood");
  // Where it fits on the small screens of CI's Macs, between the menu bar and the Dock, as macOS moves and
  // shrinks a window that doesn't fit, and no smaller than a site's window can be.
  const where = { x: 40, y: 80, width: 700, height: 560 };
  await app.electron.evaluate(({ BrowserWindow }, { title, bounds }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === title)?.setBounds(bounds), { title: "general · Fernwood", bounds: where });

  await app.restart();
  await expect.poll(() => app.electron.windows().length).toBe(2);
  const headings = await Promise.all(app.electron.windows().map((window) => window.getByRole("heading").textContent()));
  expect(headings.sort()).toEqual(["Signed in at Fernwood", "Signed out at Birchwood"]);
  expect(app.sites().find((site) => site.name === "Fernwood")?.bounds).toEqual(where);
});

test("keeps a window on its site, opening web pages elsewhere outside the app", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  await page.getByRole("link", { name: "Next room" }).click();
  await expect(page).toHaveURL(`${fernwood.origin}/rooms/2`);
  await page.getByRole("link", { name: "Elsewhere" }).click({ noWaitAfter: true });
  await page.evaluate(() => window.open("https://example.org/popup", "_blank"));
  await page.evaluate(() => (location.href = "mailto:ada@example.com"));
  await expect.poll(() => app.openedOutside()).toEqual(["https://example.com/elsewhere", "https://example.org/popup", "mailto:ada@example.com"]);

  // Where nothing outside the app should open, nothing does, as a page elsewhere asked for after them shows.
  expect(await page.evaluate(() => window.open("javascript:alert(1)"))).toBeNull();
  await page.evaluate(() => (location.href = "file:///etc/hosts"));
  await page.evaluate(() => (location.href = "other-app://open"));
  await page.evaluate(() => (location.href = "https://example.com/after"));
  await expect.poll(() => app.openedOutside()).toHaveLength(4);
  expect((await app.openedOutside()).at(-1)).toBe("https://example.com/after");
  expect(page.url()).toBe(`${fernwood.origin}/rooms/2`);
  expect(app.electron.windows()).toHaveLength(1);

  // The site's own pages open in a window of the site's.
  const [opened] = await Promise.all([app.electron.waitForEvent("window"), page.evaluate(() => window.open("/rooms/3"))]);
  await expect(opened).toHaveURL(`${fernwood.origin}/rooms/3`);
  await opened.getByRole("link", { name: "Elsewhere" }).click({ noWaitAfter: true });
  await expect.poll(() => app.openedOutside()).toHaveLength(5);
  expect(opened.url()).toBe(`${fernwood.origin}/rooms/3`);
});

test("offers to copy a link's email address, as it's written where it can't be decoded", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  await app.add(await app.electron.firstWindow(), fernwood.origin);

  for (const [linkURL, copied] of [["mailto:ada%40example.com", "ada@example.com"], ["mailto:ada%zz@example.com", "ada%zz@example.com"]] as const) {
    // A right-click on a link to the address, as Chromium tells of it, and Copy Email Address in the menu it shows.
    const offered = await app.electron.evaluate(({ BrowserWindow, Menu }, linkURL) => {
      let shown: Electron.Menu | undefined;
      Menu.prototype.popup = function (this: Electron.Menu) {
        shown = this;
      };
      const params = { linkURL, misspelledWord: "", dictionarySuggestions: [], mediaType: "none", srcURL: "", isEditable: false, selectionText: "", editFlags: {} };
      BrowserWindow.getAllWindows()[0]!.webContents.emit("context-menu", {}, params);
      shown?.items.find(({ label }) => label === "Copy Email Address")?.click();
      return shown?.items.map(({ label }) => label);
    }, linkURL);
    expect(offered).toEqual(["Copy Email Address"]);
    await expect.poll(() => app.electron.evaluate(({ clipboard }) => clipboard.readText())).toBe(copied);
  }
});

test("passes through the site's Memberful site to sign in there, and back", async ({ app }) => {
  const [fernwood, memberful] = [await fakeEmber("Fernwood"), await fakeMemberful()];
  fernwood.memberful = memberful.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  // A link straight to the Memberful site is somewhere else, like any other.
  await page.evaluate((oauth) => (location.href = oauth), `${memberful.origin}/oauth`);
  await expect.poll(() => app.openedOutside()).toEqual([`${memberful.origin}/oauth`]);

  await page.getByRole("link", { name: "Sign in with Memberful" }).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`^${memberful.origin}/oauth\\?`));
  await page.getByRole("link", { name: "Terms" }).click({ noWaitAfter: true });
  await expect.poll(() => app.openedOutside()).toEqual([`${memberful.origin}/oauth`, "https://example.com/terms"]);
  await page.getByRole("link", { name: "Allow" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");

  // Back on its site, the window passes through the Memberful site no more.
  await page.evaluate((oauth) => (location.href = oauth), `${memberful.origin}/oauth`);
  await expect.poll(() => app.openedOutside()).toHaveLength(3);
  expect(page.url()).toBe(`${fernwood.origin}/`);
});

test("passes through the site's Memberful site as someone connects their account there, and back", async ({ app }) => {
  const [fernwood, memberful, another] = [await fakeEmber("Fernwood"), await fakeMemberful(), await fakeMemberful()];
  fernwood.memberful = memberful.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  // The sign-in at another Memberful site than the one the site sends Sign in with Memberful to is somewhere else.
  const elsewhere = `${another.origin}/oauth?client_id=ember&state=2&site=${encodeURIComponent(fernwood.origin)}`;
  await page.evaluate((url) => location.assign(url), elsewhere);
  await expect.poll(() => app.openedOutside()).toEqual([elsewhere]);

  // As the profile's Connect Memberful and the sign-in page's do, the page goes straight to the Memberful site.
  await page.getByRole("link", { name: "Connect Memberful" }).click({ force: true, noWaitAfter: true });
  await expect.poll(() => page.url()).toMatch(new RegExp(`^${memberful.origin}/oauth\\?`));
  await page.getByRole("link", { name: "Allow" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");
  expect(await app.openedOutside()).toEqual([elsewhere]);
});

test("follows the site's Memberful site on to its custom domain to sign in there, and connect, and back", async ({ app }) => {
  const [fernwood, memberful] = [await fakeEmber("Fernwood"), await fakeMemberful()];
  // The address the site has for its Memberful site, which sends every page on to the same page at its custom domain, as Memberful does.
  const memberfulAddress = await fakeRedirect(memberful.origin);
  fernwood.memberful = memberfulAddress.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  await page.getByRole("link", { name: "Sign in with Memberful" }).click({ force: true });
  await expect(page).toHaveURL(new RegExp(`^${memberful.origin}/oauth\\?`));
  await page.getByRole("link", { name: "Allow" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");

  await page.getByRole("link", { name: "Connect Memberful" }).click({ force: true, noWaitAfter: true });
  await expect.poll(() => page.url()).toMatch(new RegExp(`^${memberful.origin}/oauth\\?`));
  await page.getByRole("link", { name: "Allow" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");
  expect(await app.openedOutside()).toEqual([]);
});

test("drops a sign-in at Memberful once the page moves on as the site says where its own goes", async ({ app }) => {
  const [fernwood, memberful] = [await fakeEmber("Fernwood"), await fakeMemberful()];
  fernwood.memberful = memberful.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  const answer = fernwood.holdSignIn();
  await page.getByRole("link", { name: "Connect Memberful" }).click({ force: true, noWaitAfter: true });
  await expect.poll(() => fernwood.signInsAsked).toBe(1);
  // As Ember opens another room, in the same page.
  await page.evaluate(() => history.pushState(null, "", "/rooms/2"));
  answer();
  // Long enough for the window to have opened the sign-in, had it still been wanted.
  await page.waitForTimeout(500);
  expect(page.url()).toBe(`${fernwood.origin}/rooms/2`);
  expect(await app.openedOutside()).toEqual([]);
});

test("lets the site's own pages use the camera and microphone, and refuses a frame from elsewhere", async ({ app }) => {
  const [fernwood, blog] = [await fakeEmber("Fernwood"), await fakeElsewhere()];
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  const devices = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return stream.getTracks().map((track) => track.kind).sort();
  });
  expect(devices).toEqual(["audio", "video"]);
  expect(await page.evaluate(() => Notification.permission)).toBe("granted");
  expect(await page.evaluate(async () => (await navigator.permissions.query({ name: "geolocation" })).state)).toBe("denied");

  await page.evaluate((src) => {
    const frame = Object.assign(document.createElement("iframe"), { src, allow: "camera; microphone" });
    document.body.append(frame);
    return new Promise((resolve) => frame.addEventListener("load", resolve));
  }, `${blog.origin}/`);
  const framed = page.frames().find((frame) => frame.url().startsWith(blog.origin))!;
  const refusal = await framed.evaluate(() => navigator.mediaDevices.getUserMedia({ video: true }).then(() => "allowed", (error: DOMException) => error.name));
  expect(refusal).toBe("NotAllowedError");
});

test("saves a file the site offers where the person says, from the Downloads folder", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ember-desktop-saved-")), "report.txt");

  // As the person picks where to save it in the dialog, which starts in the Downloads folder.
  const asked = app.electron.evaluate(
    ({ app, BrowserWindow }, saved) =>
      new Promise<{ defaultPath?: string; downloads: string }>((resolve) => {
        BrowserWindow.getAllWindows()[0]!.webContents.session.once("will-download", (_event, item) => {
          const { defaultPath } = item.getSaveDialogOptions();
          item.setSavePath(saved);
          item.once("done", () => resolve({ defaultPath, downloads: app.getPath("downloads") }));
        });
      }),
    saved,
  );
  await page.getByRole("link", { name: "Download the report" }).click();
  const { defaultPath, downloads } = await asked;
  expect(defaultPath).toBe(path.join(downloads, "Q3 report.txt"));
  expect(fs.readFileSync(saved, "utf8")).toBe("Sales are up.");
  await expect(page).toHaveURL(`${fernwood.origin}/`);
});

test("asks before leaving a page that has changes it hasn't saved", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await page.evaluate(() => addEventListener("beforeunload", (event) => event.preventDefault()));
  // A page asks only once someone has done something on it.
  await page.getByRole("heading").click();

  await app.answer("Stay");
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await page.waitForTimeout(500);
  expect(page.isClosed()).toBe(false);

  await app.answer("Leave");
  await Promise.all([page.waitForEvent("close"), app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())]);
});

test("says when a site can't be reached, and opens it once it can be", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);

  await fernwood.close();
  await page.reload().catch(() => undefined);
  await expect(page.getByRole("heading")).toHaveText(`Can't reach ${new URL(fernwood.origin).host}`);
  await expect(page.getByText("Check that you're online. The app tries again as soon as you are.")).toBeVisible();

  await fernwood.reopen();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading")).toHaveText("Signed out at Fernwood");
  await expect(page).toHaveURL(`${fernwood.origin}/`);
});

test("says when the site's Memberful site can't be reached, and tries again from the site", async ({ app }) => {
  const [fernwood, memberful] = [await fakeEmber("Fernwood"), await fakeMemberful()];
  fernwood.memberful = memberful.origin;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await memberful.close();

  await page.getByRole("link", { name: "Sign in with Memberful" }).click({ force: true });
  await expect(page.getByRole("heading")).toHaveText(`Can't reach ${new URL(memberful.origin).host}`);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading")).toHaveText("Signed out at Fernwood");
  await expect(page).toHaveURL(`${fernwood.origin}/`);
});

test("opens a site at the custom domain it moved to, and follows it when it moves again", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  fernwood.customDomain = new URL(fernwood.at("localhost")).host;
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await expect(page).toHaveURL(`${fernwood.at("localhost")}/`);

  // Its pages move as they open, to the same page at the custom domain.
  fernwood.customDomain = new URL(fernwood.origin).host;
  await page.goto(`${fernwood.at("localhost")}/rooms/2`);
  await page.evaluate((moved) => location.replace(`${moved}/rooms/2`), fernwood.origin);
  await expect(page).toHaveURL(`${fernwood.origin}/rooms/2`);
  expect(app.sites()).toMatchObject([{ address: fernwood.origin }]);
  expect(await app.openedOutside()).toEqual([]);
});

test("follows a site to the address its server sends its pages on to once it's moved there", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await page.goto(`${fernwood.origin}/rooms/2`);

  fernwood.redirectsTo = fernwood.at("localhost");
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.reload());
  await expect.poll(() => page.url()).toBe(`${fernwood.at("localhost")}/rooms/2`);
  await expect(page.getByRole("heading")).toHaveText("Signed out at Fernwood");
  expect(app.sites()).toMatchObject([{ address: fernwood.at("localhost") }]);
  expect(await app.openedOutside()).toEqual([]);
});

test("removes a site, forgetting its sign-in, and asks for another once there's none", async ({ app }) => {
  const fernwood = await fakeEmber("Fernwood");
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await page.goto(`${fernwood.origin}/sign-in`);
  await expect(page.getByRole("heading")).toHaveText("Signed in at Fernwood");

  await app.answer("Remove");
  const [addSite] = await Promise.all([app.electron.waitForEvent("window"), app.clickMenu("Sites", "Remove Fernwood…")]);
  await expect(addSite).toHaveTitle("Add a Site");
  expect(page.isClosed()).toBe(true);
  expect(app.sites()).toEqual([]);

  const again = await app.add(addSite, fernwood.origin);
  await expect(again.getByRole("heading")).toHaveText("Signed out at Fernwood");
});

test("opens a site again as it starts where a window the site's pages opened was open as it quit", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  let atFernwood = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  await app.add(await app.electron.waitForEvent("window"), birchwood.origin);
  const titles = () => app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.getTitle()).sort());
  const openRoom = async () => {
    const [opened] = await Promise.all([app.electron.waitForEvent("window"), atFernwood.evaluate(() => window.open("/rooms/3"))]);
    await opened.waitForLoadState("domcontentloaded");
  };
  const close = (title: string) =>
    app.electron.evaluate(
      ({ BrowserWindow }, title) =>
        new Promise<void>((resolve) => {
          const window = BrowserWindow.getAllWindows().find((window) => window.getTitle() === title)!;
          window.once("closed", () => resolve());
          window.close();
        }),
      title,
    );

  // Fernwood's own window closes while Birchwood's is open, but the window its page opened is open as the app quits.
  await openRoom();
  await close("general · Fernwood");
  await app.restart();
  await expect.poll(titles).toEqual(["general · Birchwood", "general · Fernwood"]);

  // Birchwood's closes too, not the last window open, which is the one Fernwood's page opened. Playwright
  // can hear where a window's page is a moment after the app has the page's title.
  const fernwoodsPage = () => app.electron.windows().find((page) => page.url().startsWith(fernwood.origin));
  await expect.poll(fernwoodsPage).toBeDefined();
  atFernwood = fernwoodsPage()!;
  await openRoom();
  await close("general · Fernwood");
  await close("general · Birchwood");
  await app.restart();
  await expect.poll(titles).toEqual(["general · Fernwood"]);
});

test("counts the windows a site's pages opened as the site's, and opens another site's in their place as it's removed", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  const page = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  await app.add(await app.electron.waitForEvent("window"), birchwood.origin);
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === "general · Birchwood")?.close());
  await page.goto(`${fernwood.origin}/sign-in`);

  // A window the site's pages opened stays open as the site's own closes, as a browser's would.
  const [opened] = await Promise.all([app.electron.waitForEvent("window"), page.evaluate(() => window.open("/rooms/3"))]);
  await opened.waitForLoadState("domcontentloaded");
  await Promise.all([page.waitForEvent("close"), app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === "general · Fernwood")?.close())]);
  await expect(opened.getByRole("heading")).toHaveText("Signed in at Fernwood");
  await app.electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.focus());
  const sitesMenu = () =>
    app.electron.evaluate(({ BrowserWindow, Menu }) => ({
      inFront: BrowserWindow.getFocusedWindow()?.webContents.getURL(),
      items: Menu.getApplicationMenu()
        ?.items.find((item) => item.label === "Sites")
        ?.submenu?.items.filter((item) => item.type !== "separator")
        .map(({ label, checked, enabled }) => ({ label, checked, enabled })),
    }));
  await expect.poll(sitesMenu).toEqual({
    inFront: `${fernwood.origin}/rooms/3`,
    items: [
      { label: "Fernwood", checked: true, enabled: true },
      { label: "Birchwood", checked: false, enabled: true },
      { label: "Add Site…", checked: false, enabled: true },
      { label: "Remove Fernwood…", checked: false, enabled: true },
    ],
  });

  // Its window was the only one open, so Birchwood's opens as it closes, rather than the app quitting.
  await app.answer("Remove");
  const [atBirchwood] = await Promise.all([app.electron.waitForEvent("window"), app.clickMenu("Sites", "Remove Fernwood…")]);
  await expect(atBirchwood.getByRole("heading")).toHaveText("Signed out at Birchwood");
  expect(opened.isClosed()).toBe(true);
  expect(app.sites()).toMatchObject([{ name: "Birchwood" }]);

  await app.clickMenu("Sites", "Add Site…");
  const again = await app.add(await app.electron.waitForEvent("window"), fernwood.origin);
  await expect(again.getByRole("heading")).toHaveText("Signed out at Fernwood");
});
