import { openRoom, signInAs } from "../../fixtures";
import { settle } from "./audits";
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
  // Radix starts listening for presses outside the drawer a timer tick after it opens, and a raw
  // tap sent the moment it shows can beat that. Wait for it to finish sliding in, as a person would.
  await settle(page);
  const { width, height } = page.viewportSize()!;
  await page.touchscreen.tap(width - 6, height / 2);
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("the drawer opens on its close button, which closes it and returns focus to the menu button", async ({ page }) => {
  const menu = page.getByRole("button", { name: "Open conversations" });
  await menu.tap();
  const close = page.getByRole("dialog").getByRole("button", { name: "Close conversations" });
  await expect(close).toBeFocused();
  // While the drawer is open, everything behind it is hidden from assistive tech, the menu button
  // too, which is named for closing it.
  await expect(page.getByRole("button", { name: "Close conversations", expanded: true, includeHidden: true })).toBeAttached();
  await close.tap();
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

test("rotating the phone with the drawer open leaves the page usable", async ({ page, room }) => {
  await page.getByRole("button", { name: "Open conversations" }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Turn it on its side, or upright for a phone already on its side. With viewport-fit=cover the
  // page runs the full length of the screen.
  const [short, long] = await page.evaluate(() => [Math.min(screen.width, screen.height), Math.max(screen.width, screen.height)]);
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize(width < height ? { width: long, height: short } : { width: short, height: long });
  if (hasDrawerLayout(page)) {
    await expect(page.getByRole("dialog")).toBeVisible();
  } else {
    // A big phone on its side is past 900px, where there's no drawer. It has to close rather than
    // hide, or it dims the page and takes the next tap.
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator("[data-slot=sheet-overlay]")).toBeHidden();
    const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
    await composer.tap();
    await expect(composer).toBeFocused();
  }
});
