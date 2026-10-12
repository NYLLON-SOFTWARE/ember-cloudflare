import { openRoom, signInAs } from "../../fixtures";
import { expect, hasDrawerLayout, test } from "./fixtures";

test.beforeEach(async ({ page, session, room }) => {
  test.skip(!hasDrawerLayout(page), "Wider than 900px the rail and sidebar are always on screen");
  await signInAs(page, session);
  await openRoom(page, room);
});

test("the conversations drawer opens from the header and fits", async ({ page, screenIsFine }) => {
  await page.getByRole("button", { name: "Open conversations" }).tap();
  const drawer = page.getByRole("dialog", { name: "Conversations" });
  await expect(drawer).toBeVisible();
  await screenIsFine();

  // As in ember-rust, the drawer leaves a strip of the room showing, so it reads as a drawer
  // and there's somewhere to tap to close it.
  const box = (await drawer.boundingBox())!;
  expect(page.viewportSize()!.width - (box.x + box.width)).toBeGreaterThanOrEqual(16);
});

test("tapping outside the drawer closes it", async ({ page }) => {
  await page.getByRole("button", { name: "Open conversations" }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width - 6, height / 2);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the drawer's close button closes it and returns focus to the menu button", async ({ page }) => {
  const menu = page.getByRole("button", { name: "Open conversations" });
  await menu.tap();
  // While the drawer is open, everything behind it is hidden from assistive tech, this button too.
  await expect(page.getByRole("button", { name: "Open conversations", includeHidden: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("dialog").getByRole("button", { name: "Close conversations" }).tap();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
});

test("choosing a room closes the drawer", async ({ page, room }) => {
  await page.getByRole("button", { name: "Open conversations" }).tap();
  await page.getByRole("dialog").getByRole("link", { name: room.name }).tap();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
});
