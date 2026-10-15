import { feature } from "@ember/parity";
import { openRoom, signInAs } from "../../fixtures";
import { settle } from "./audits";
import { expect, hasDrawerLayout, test } from "./fixtures";

test.beforeEach(async ({ page, session, room }) => {
  await signInAs(page, session);
  await openRoom(page, room);
});

test.describe(feature("dms.picker"), () => {
  test("New direct message fits, with someone picked, and Cancel closes it", async ({ page, room, screenIsFine }) => {
    await page.goto("/rooms/directs/new");
    const dialog = page.getByRole("dialog", { name: "New direct message" });
    await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option").first().tap();
    await expect(dialog.getByRole("group", { name: "Selected people" })).toBeVisible();
    await settle(page);
    await screenIsFine();
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("New direct message opens from the drawer, which closes, and gives focus back to the menu button", async ({ page }) => {
    test.skip(!hasDrawerLayout(page), "Wider than 900px the rail and sidebar are always on screen");
    const menu = page.getByRole("button", { name: "Open conversations" });
    await menu.tap();
    await page.getByRole("dialog", { name: "Conversations" }).getByRole("link", { name: "DMs" }).tap();
    const dialog = page.getByRole("dialog", { name: "New direct message" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Conversations" })).toBeHidden();
    await expect(dialog.getByRole("combobox", { name: "Search people" })).toBeFocused();
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
