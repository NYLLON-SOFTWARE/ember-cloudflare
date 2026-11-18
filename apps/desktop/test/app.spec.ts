import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeElsewhere, fakeEmber, fakeMemberful } from "./fake-sites.ts";
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

test("keeps each site's sign-in apart, and opens the windows that were open as it quit, where they were", async ({ app }) => {
  const [fernwood, birchwood] = [await fakeEmber("Fernwood"), await fakeEmber("Birchwood")];
  const atFernwood = await app.add(await app.electron.firstWindow(), fernwood.origin);
  await app.clickMenu("Sites", "Add Site…");
  const atBirchwood = await app.add(await app.electron.waitForEvent("window"), birchwood.origin);

  await atFernwood.goto(`${fernwood.origin}/sign-in`);
  await expect(atFernwood.getByRole("heading")).toHaveText("Signed in at Fernwood");
  await atBirchwood.reload();
  await expect(atBirchwood.getByRole("heading")).toHaveText("Signed out at Birchwood");
  await app.electron.evaluate(({ BrowserWindow }, title) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === title)?.setBounds({ x: 40, y: 50, width: 900, height: 700 }), "general · Fernwood");

  await app.restart();
  await expect.poll(() => app.electron.windows().length).toBe(2);
  const headings = await Promise.all(app.electron.windows().map((window) => window.getByRole("heading").textContent()));
  expect(headings.sort()).toEqual(["Signed in at Fernwood", "Signed out at Birchwood"]);
  expect(app.sites().find((site) => site.name === "Fernwood")?.bounds).toEqual({ x: 40, y: 50, width: 900, height: 700 });
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
