import { drawnPicture, editorField, openRoom, signInAs } from "../../fixtures";
import { settle } from "./audits";
import { expect, hasPhoneLayout, tabBar, test } from "./fixtures";

// A phone's navigation, Slack's: a tab bar along the bottom, Home, DMs, Activity and Files, each a
// list, and conversations, threads, profiles and pictures opening over them one at a time, with Back.

test.beforeEach(async ({ page, session }) => {
  test.skip(!hasPhoneLayout(page), "Wider than 900px the rail and sidebar are always on screen");
  await signInAs(page, session);
});

test("each tab opens its list, marked in the tab bar, and fits the phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const tabs = tabBar(page);
  for (const [tab, path, heading] of [
    ["Home", "/", null],
    ["DMs", "/dms", "DMs"],
    ["Activity", "/activity", "Activity"],
    ["Files", "/files", "Files"],
  ] as const) {
    await tabs.getByRole("link", { name: tab, exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`${path === "/" ? "" : path}/?$`));
    await expect(tabs.getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page");
    if (heading) await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await screenIsFine();
  }
});

test("Home is the list of conversations rather than the room last visited, and a room opens over it, with Back", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  await page.goto("/");
  await expect(page.getByRole("list", { name: "Shortcuts" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await screenIsFine();

  await page.getByRole("main").getByRole("link", { name: room.name }).tap();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
  // The tab it was opened from stays marked.
  await expect(tabBar(page).getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Back" }).tap();
  await expect(page).toHaveURL(/\/$/);
  // The browser's Back, a phone's back gesture, goes the same way.
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test("Home's cards, what's above the rooms on the desktop, scroll sideways and each opens over Home, with Back", async ({ page, screenIsFine }) => {
  await page.goto("/");
  const cards = page.getByRole("list", { name: "Shortcuts" });
  await expect(cards.getByRole("link")).toHaveText([/^Threads/, /^Drafts & sent/, /^People/, /^Saved/, /^To-dos/]);
  // Wider than a phone held upright, where the row scrolls rather than squeezing them.
  const { width, height } = page.viewportSize()!;
  if (width < height) expect(await cards.evaluate((row) => row.scrollWidth > row.clientWidth)).toBe(true);
  await screenIsFine();

  await cards.getByRole("link", { name: /^Threads/ }).tap();
  await expect(page).toHaveURL(/\/threads$/);
  await expect(page.getByRole("heading", { level: 1, name: "Threads" })).toBeVisible();
  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Back" }).tap();
  await expect(page).toHaveURL(/\/$/);
});

test("a room's top bar is Back, its name with how many are in it, and its buttons, and fits the phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const header = page.getByRole("navigation", { name: "Page" });
  await expect(header.getByRole("link", { name: "Back" })).toBeVisible();
  const details = header.getByRole("link", { name: new RegExp(`${room.name}.*members?`) });
  await expect(details).toBeVisible();
  await expect(header.getByRole("button", { name: "Favorite room" })).toBeVisible();
  await screenIsFine();
  await details.tap();
  await expect(page).toHaveURL(new RegExp(`/rooms/(opens|closeds)/${room.id}/edit$`));
});

test("room, thread and profile open one over another, and Back returns the way they came", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  const parent = await ada.say("Who's bringing snacks?");
  await ada.reply(parent.id, "I'll bring fruit");
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: room.name }).tap();

  await page.getByRole("article").filter({ hasText: "Who's bringing snacks?" }).getByRole("link", { name: /^1 reply\b/ }).tap();
  const thread = page.getByRole("complementary", { name: "Thread" });
  await expect(thread.getByRole("heading", { name: "Thread" })).toBeVisible();
  await screenIsFine();

  await thread.getByRole("article").filter({ hasText: "I'll bring fruit" }).getByRole("link", { name: "Ada" }).first().tap();
  await expect(page).toHaveURL(/\/users\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: "Ada" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ping Ada" })).toContainText("Message");
  await screenIsFine();

  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Back" }).tap();
  await expect(thread).toBeVisible();
  await thread.getByRole("link", { name: `Back to ${room.name}` }).tap();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
  await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Back" }).tap();
  await expect(page).toHaveURL(/\/$/);
});

test("the composer is Slack's pill until it's tapped, then opens with its buttons, and the tab bar makes way for the keyboard", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const card = page.locator("[data-composer-card]");
  const send = page.getByRole("button", { name: "Send Message" });
  await expect(send).toBeHidden();
  expect((await card.boundingBox())!.height).toBeLessThan(50);
  await expect(tabBar(page)).toBeVisible();
  await screenIsFine();

  await editorField(page, "Write a message").tap();
  await expect(send).toBeVisible();
  expect((await card.boundingBox())!.height).toBeGreaterThan(80);
  await expect(tabBar(page)).toBeHidden();
  // Send is dimmed until there's something to send.
  await expect(send).toHaveCSS("opacity", "0.4");
  await page.keyboard.type("Hi");
  await expect(send).toHaveCSS("opacity", "1");
  await screenIsFine();
});

test("a picture opens over the room, and Back closes it there", async ({ page, room }) => {
  await openRoom(page, room);
  await page.locator(".composer input[type=file]").setInputFiles(await drawnPicture(page, "dot.png", 40, 20));
  await page.getByRole("button", { name: "Send Message" }).tap();
  await page.getByRole("article").getByRole("link", { name: "dot.png" }).tap();
  const viewer = page.getByRole("dialog", { name: "Image Viewer (Press escape to close)" });
  await expect(viewer).toBeVisible();
  await settle(page);

  await page.goBack();
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
  await expect(page.getByRole("log", { name: `Messages in ${room.name}` })).toBeVisible();

  // Closed from itself, it leaves no step in the history behind.
  await page.getByRole("article").getByRole("link", { name: "dot.png" }).tap();
  await viewer.getByRole("button", { name: "Close image viewer" }).tap();
  await expect(viewer).toBeHidden();
  await expect.poll(() => page.evaluate(() => (history.state as { overlay?: boolean } | null)?.overlay ?? false)).toBe(false);
  await page.goBack();
  await expect(page).not.toHaveURL(new RegExp(`/rooms/${room.id}$`));
});

test("Activity's feed takes the whole screen under its top bar, with its filters, and fits the phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  await tabBar(page).getByRole("link", { name: "Activity", exact: true }).tap();
  await expect(page).toHaveURL(/\/activity$/);
  await expect(page.getByRole("navigation", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Your profile" })).toBeVisible();
  await screenIsFine();
});

test("turning a phone on its side past 900px swaps the tab bar for the rail", async ({ page, room }) => {
  await openRoom(page, room);
  const [short, long] = await page.evaluate(() => [Math.min(screen.width, screen.height), Math.max(screen.width, screen.height)]);
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize(width < height ? { width: long, height: short } : { width: short, height: long });
  if (hasPhoneLayout(page)) await expect(tabBar(page)).toBeVisible();
  else {
    await expect(tabBar(page)).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  }
});
