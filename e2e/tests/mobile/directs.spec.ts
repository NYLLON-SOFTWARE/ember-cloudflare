import type { Sidebar } from "@ember/protocol";
import { openRoom, signInAs } from "../../fixtures";
import { settle } from "./audits";
import { expect, hasPhoneLayout, showConversations, tabBar, test } from "./fixtures";

test.beforeEach(async ({ page, session, room }) => {
  await signInAs(page, session);
  await openRoom(page, room);
});

test.describe("New direct message dialog", () => {
  test("New direct message fits, with someone picked, and Cancel closes it", async ({ page, room, screenIsFine }) => {
    await page.goto("/rooms/directs/new");
    const dialog = page.getByRole("dialog", { name: "New direct message" });
    // Over the room last visited, or on a phone, Home.
    await expect(page).toHaveURL(hasPhoneLayout(page) ? /\/$/ : new RegExp(`/rooms/${room.id}$`));
    await expect(dialog).toBeVisible();
    await dialog.getByRole("option").first().tap();
    await expect(dialog.getByRole("group", { name: "Selected people" })).toBeVisible();
    await settle(page);
    await screenIsFine();
    await dialog.getByRole("button", { name: "Cancel" }).tap();
    await expect(dialog).toBeHidden();
  });

  test("New direct message opens from Home's and DMs' floating button, and gives focus back to it", async ({ page }) => {
    test.skip(!hasPhoneLayout(page), "Wider than 900px the rail has DMs, and the sidebar New direct message");
    for (const tab of ["Home", "DMs"]) {
      await tabBar(page).getByRole("link", { name: tab, exact: true }).tap();
      // Floating over the list, after the sidebar's own on Home.
      const plus = page.getByRole("main").getByRole("link", { name: "New direct message" }).last();
      await plus.tap();
      const dialog = page.getByRole("dialog", { name: "New direct message" });
      await expect(dialog.getByRole("combobox", { name: "Search people" })).toBeFocused();
      await dialog.getByRole("button", { name: "Close" }).tap();
      await expect(dialog).toBeHidden();
      await expect(plus).toBeFocused();
    }
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
