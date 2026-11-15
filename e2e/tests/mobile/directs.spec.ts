import type { Sidebar } from "@ember/protocol";
import { openRoom, signInAs } from "../../fixtures";
import { settle } from "./audits";
import { expect, hasDrawerLayout, test } from "./fixtures";

test.beforeEach(async ({ page, session, room }) => {
  await signInAs(page, session);
  await openRoom(page, room);
});

test.describe("New direct message dialog", () => {
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

  test("DMs in the drawer opens the DMs page, closing the drawer, and its New direct message opens the dialog", async ({ page }) => {
    test.skip(!hasDrawerLayout(page), "Wider than 900px the rail and sidebar are always on screen");
    await page.getByRole("button", { name: "Open conversations" }).tap();
    await page.getByRole("dialog", { name: "Conversations" }).getByRole("link", { name: "DMs" }).tap();
    await expect(page).toHaveURL(/\/dms$/);
    await expect(page.getByRole("dialog", { name: "Conversations" })).toBeHidden();
    await expect(page.getByRole("region", { name: "Direct messages" })).toBeVisible();

    const compose = page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "New direct message" });
    await compose.tap();
    const dialog = page.getByRole("dialog", { name: "New direct message" });
    await expect(dialog.getByRole("combobox", { name: "Search people" })).toBeFocused();
    await page.keyboard.type("Ada");
    await expect(dialog.getByRole("combobox", { name: "Search people" })).toHaveValue("Ada");
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toBeHidden();
    await expect(compose).toBeFocused();
  });
});

test.describe("Suggested people", () => {
  test("the people suggested for DMs fit under the DMs on the DMs page, and are easy to tap", async ({ page, room, screenIsFine }) => {
    // The server's suggestions, the oldest accounts, with only this test's room.
    await page.route("**/api/sidebar", async (route) => {
      const { suggestions } = (await (await route.fetch()).json()) as Sidebar;
      await route.fulfill({ json: { rooms: [{ ...room, kind: "open", icon: null, unread: false, involvement: "mentions" }], favorites: { rooms: [], version: 0 }, sharedOrder: [], invitation: null, suggestions, huddles: {} } satisfies Sidebar });
    });
    // They're on the DMs page, under its DMs.
    await page.goto("/dms");
    await expect(page.getByRole("region", { name: "Direct messages" }).getByRole("button", { name: /^Start a direct message with / }).first()).toBeVisible();
    await settle(page);
    await screenIsFine();
    // Lets the test end while the sidebar is loading again.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});
