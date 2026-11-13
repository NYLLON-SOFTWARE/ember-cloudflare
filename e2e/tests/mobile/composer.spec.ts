import { editorField, openRoom, signInAs } from "../../fixtures";
import { expect, hasPhoneLayout, openKeyboard, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("Enter starts a new line on a phone, and Send posts", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  await composer.tap();
  // Phone keyboards have no Shift+Enter, so Enter has to start the new paragraph.
  await page.keyboard.type("First line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await expect(composer.locator("p")).toHaveText(["First line", "Second line"]);
  await expect(page.getByRole("article")).toHaveCount(0);

  await page.getByRole("button", { name: "Send Message" }).tap();
  await expect(page.getByRole("article").filter({ hasText: "First line" })).toContainText("Second line");
  await expect(composer).toHaveText("");
});

test("sending keeps the keyboard up", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  await composer.tap();
  await page.keyboard.type("Hello");
  // A blur would drop the keyboard and, with resizes-content, resize the whole page twice.
  await composer.evaluate((field) => field.addEventListener("blur", () => field.setAttribute("data-blurred", "")));
  await page.getByRole("button", { name: "Send Message" }).tap();
  await expect(page.getByRole("article").filter({ hasText: "Hello" })).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).not.toHaveAttribute("data-blurred");
});

test("the composer keeps its size as its editor loads, so the timeline doesn't move under a tap", async ({ page, room }) => {
  // The editor's code loads once the room has shown its messages. Holding it shows the composer without it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/rich-text-editor-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  const timeline = page.getByRole("log", { name: `Messages in ${room.name}` });
  await expect(composer).toHaveCount(0);
  const before = await timeline.boundingBox();

  release();
  await expect(composer).toBeVisible();
  expect(await timeline.boundingBox()).toEqual(before);
});

test("tapping anywhere in the text area of the composer focuses it", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  const box = (await composer.boundingBox())!;
  await expect(composer).not.toBeFocused();
  await page.touchscreen.tap(box.x + 4, box.y + 4);
  await expect(composer).toBeFocused();
});

test("the composer and the newest message stay in view when the keyboard opens", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  for (let i = 1; i <= 30; i++) await ada.say(`Message ${i}`);
  await openRoom(page, room);
  const newest = page.getByText("Message 30", { exact: true });
  await expect(newest).toBeInViewport();

  const composer = editorField(page, "Write a message");
  await composer.tap();
  await openKeyboard(page);

  await expect(composer).toBeFocused();
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Send Message" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("navigation", { name: "Page" })).toBeInViewport({ ratio: 1 });
  const { width, height } = page.viewportSize()!;
  // In landscape the keyboard leaves room for little more than the header and the composer.
  if (height > width) await expect(newest).toBeInViewport({ ratio: 1 });

  await page.keyboard.type("Sent with the keyboard up");
  await page.getByRole("button", { name: "Send Message" }).tap();
  const sent = page.getByRole("article").filter({ hasText: "Sent with the keyboard up" });
  if (height > width) await expect(sent).toBeInViewport({ ratio: 1 });
  await expect(composer).toBeFocused();
  await screenIsFine();
});

test("the people @ lists show above the text, fit the phone, each big enough to tap, and a tap mentions one", async ({ page, room, participant, screenIsFine }) => {
  // A word only this test's people have in their names, as everyone is in the room.
  const tag = crypto.randomUUID().slice(0, 8);
  await participant(`Bea ${tag}`);
  await participant(`Cy ${tag}`);
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  await composer.tap();
  await page.keyboard.type(`Hi @${tag}`);
  const people = page.getByRole("listbox").getByRole("option");
  await expect(people).toHaveText([`Bea ${tag}`, `Cy ${tag}`]);
  // Above the line being written: two would fit under it, where the keyboard and the home indicator cover them.
  const line = (await composer.locator("p").first().boundingBox())!;
  const list = (await page.getByRole("listbox").boundingBox())!;
  expect(list.y + list.height).toBeLessThan(line.y + line.height);
  await screenIsFine();

  await people.filter({ hasText: "Cy" }).tap();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(composer.getByText(`Cy ${tag}`, { exact: true })).toBeVisible();
  await expect(composer).toBeFocused();

  // Sent, the mention's avatar links to Cy's page, as small as the line it sits in, as a link in a sentence is.
  await page.getByRole("button", { name: "Send Message" }).tap();
  const mention = page.getByRole("article").getByRole("link", { name: `Cy ${tag}` });
  await expect(mention).toBeVisible();
  await screenIsFine();
});

test("the pill's + is a 36px circle inset 5px all round, and Aa swaps the buttons for the tools without the box changing height", async ({ page, room, screenIsFine }) => {
  test.skip(!hasPhoneLayout(page), "Wider than 900px the composer is the desktop's");
  await openRoom(page, room);
  const card = page.locator("[data-composer-card]");
  const attach = page.getByRole("button", { name: "Attach" });
  const pill = (await card.boundingBox())!;
  const plus = (await attach.boundingBox())!;
  expect(pill.height).toBe(46);
  // Its 44px target sits 1px inside the pill's edge, and the circle 4px inside that.
  expect([plus.x - pill.x, plus.y - pill.y, plus.width, plus.height]).toEqual([1, 1, 44, 44]);
  expect(await attach.evaluate((button) => getComputedStyle(button, "::before").inset)).toBe("4px");

  await editorField(page, "Write a message").tap();
  const open = (await card.boundingBox())!.height;
  await page.getByRole("button", { name: "Formatting" }).tap();
  const tools = page.getByRole("toolbar", { name: "Formatting" });
  await expect(tools).toBeVisible();
  expect((await card.boundingBox())!.height).toBe(open);

  // Every tool is in reach between × and Send, scrolling sideways where they don't all fit.
  const send = (await page.getByRole("button", { name: "Send Message" }).boundingBox())!;
  for (const tool of await tools.getByRole("button").all()) {
    await tool.scrollIntoViewIfNeeded();
    const box = (await tool.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(send.x + 1);
  }
  await screenIsFine();
});

test("closing Custom time leaves the composer open, with Send, rather than its pill", async ({ page, room }) => {
  test.skip(!hasPhoneLayout(page), "Wider than 900px the composer is the desktop's");
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  await composer.tap();
  await page.keyboard.type("Later, please");
  const send = page.getByRole("button", { name: "Send Message" });
  // A long press on Send opens Send later, once there's something to schedule and the room can take it.
  const later = page.getByRole("dialog", { name: "Send later" });
  await expect(async () => {
    await send.dispatchEvent("contextmenu");
    await expect(later).toBeVisible({ timeout: 2000 });
  }).toPass();
  await later.getByRole("button", { name: "Custom time" }).tap();
  const custom = page.getByRole("dialog", { name: "Schedule message" });
  await expect(custom.getByLabel("Time")).toBeVisible();
  await custom.getByRole("button", { name: "Cancel" }).tap();
  await expect(custom).toBeHidden();
  await expect(composer).toBeFocused();
  await expect(send).toBeVisible();
});
