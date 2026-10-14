import { openRoom, signInAs } from "../../fixtures";
import { expect, openKeyboard, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("Enter starts a new line on a phone, and Send posts", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
  await composer.tap();
  // Phone keyboards have no Shift+Enter, so Enter has to be the newline, as in ember-rust.
  await page.keyboard.type("First line");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second line");
  await expect(composer).toHaveValue("First line\nSecond line");
  await expect(page.getByRole("article")).toHaveCount(0);

  await page.getByRole("button", { name: "Send" }).tap();
  await expect(page.getByRole("article").filter({ hasText: "First line" })).toContainText("Second line");
  await expect(composer).toHaveValue("");
});

test("sending keeps the keyboard up", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
  await composer.tap();
  await page.keyboard.type("Hello");
  // A blur would drop the keyboard and, with resizes-content, resize the whole page twice.
  await composer.evaluate((field) => field.addEventListener("blur", () => field.setAttribute("data-blurred", "")));
  await page.getByRole("button", { name: "Send" }).tap();
  await expect(page.getByRole("article").filter({ hasText: "Hello" })).toBeVisible();
  await expect(composer).toBeFocused();
  await expect(composer).not.toHaveAttribute("data-blurred");
});

test("tapping anywhere in the text area of the composer focuses it", async ({ page, room }) => {
  await openRoom(page, room);
  const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
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

  const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
  await composer.tap();
  await openKeyboard(page);

  await expect(composer).toBeFocused();
  await expect(composer).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Send" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("navigation", { name: "Page" })).toBeInViewport({ ratio: 1 });
  const { width, height } = page.viewportSize()!;
  // In landscape the keyboard leaves room for little more than the header and the composer.
  if (height > width) await expect(newest).toBeInViewport({ ratio: 1 });

  await page.keyboard.type("Sent with the keyboard up");
  await page.getByRole("button", { name: "Send" }).tap();
  const sent = page.getByRole("article").filter({ hasText: "Sent with the keyboard up" });
  if (height > width) await expect(sent).toBeInViewport({ ratio: 1 });
  await expect(composer).toBeFocused();
  await screenIsFine();
});
