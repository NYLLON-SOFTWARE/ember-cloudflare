import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { join } from "./fixtures";

/**
 * Sends `body` to the API from `page`, as the app does, which over HTTPS is the only way the Worker
 * takes a change, and answers the status.
 */
const send = (page: Page, method: string, path: string, body: unknown) =>
  page.evaluate(
    async ([method, path, body]) => (await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status,
    [method, path, body] as const,
  );

/** The rooms `tab`'s sidebar lists, top to bottom. */
const sidebarRooms = (tab: Page) => tab.getByRole("complementary", { name: "Conversations" }).getByRole("region", { name: "Rooms" }).getByRole("link");

/** Each tab waits up to 5 seconds at random before loading its sidebar again for a new order. */
const REORDERED = { timeout: 15_000 };

test.describe(feature("sidebar.shared-order"), () => {
  test("the administrator puts rooms in order for everyone, which members' sidebars follow without being loaded again", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit#membership-settings");
    await signInAsAdministrator(page);
    // Signed in once it shows.
    const joinLink = page.getByRole("textbox", { name: "Share to invite more people" });
    await expect(joinLink).toBeVisible();
    const list = page.getByRole("list", { name: "Room order" });
    // Rooms of this run's own, since a server kept from an earlier run has others.
    const run = crypto.randomUUID().slice(0, 8);
    const [first, second] = [`Order ${run} a`, `Order ${run} b`];
    // Open rooms, which everyone is in.
    for (const name of [first, second]) expect(await send(page, "POST", "/api/rooms", { kind: "open", name })).toBe(201);
    const member = await join(browser, baseURL!, await joinLink.inputValue(), `Grace ${run}`);
    await page.getByRole("link", { name: "Rooms and permissions" }).click();
    await expect(list).toBeVisible();

    const rows = list.getByRole("listitem");
    const row = (name: string) => rows.filter({ hasText: name });
    /** The rooms the list shows, top to bottom, by the names of their links to their settings. */
    const ordered = async () => (await rows.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label")!))).map((label) => label.replace("Settings for ", ""));
    /** Expects the room named `name` to be the list's `index`th. */
    const expectAt = (index: number, name: string) => expect(rows.nth(index).getByRole("link")).toHaveAccessibleName(`Settings for ${name}`);
    const saveOrder = page.getByRole("button", { name: "Save order" });
    await expect(row(second)).toBeVisible();
    await expect(saveOrder).toBeDisabled();

    try {
      // Up to the top with Alt and the up arrow, one row at a time.
      const above = (await ordered()).indexOf(second);
      await row(second).focus();
      for (let i = 0; i < above; i++) await page.keyboard.press("Alt+ArrowUp");
      await expectAt(0, second);
      await expect(row(second)).toBeFocused();
      await expect(page.getByText("Unsaved room order. Save to apply it to everyone.")).toBeVisible();
      await saveOrder.click();
      await expect(page.getByText("Room order saved for everyone.")).toBeVisible();
      await expect(saveOrder).toBeDisabled();
      await expect(sidebarRooms(member).first()).toHaveText(`#${second}`, REORDERED);

      // Then the other just below it, and dragged by its grip over it.
      const below = (await ordered()).indexOf(first);
      await row(first).focus();
      for (let i = 1; i < below; i++) await page.keyboard.press("Alt+ArrowUp");
      await expectAt(1, first);
      await page.getByRole("button", { name: `Move ${first}` }).dragTo(rows.first(), { targetPosition: { x: 40, y: 4 } });
      await expectAt(0, first);
      await saveOrder.click();
      await expect(page.getByText("Room order saved for everyone.")).toBeVisible();
      await expect(sidebarRooms(member).nth(0)).toHaveText(`#${first}`, REORDERED);
      await expect(sidebarRooms(member).nth(1)).toHaveText(`#${second}`);

      // Cancel puts back what's saved.
      await rows.first().focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expectAt(0, second);
      await page.getByRole("button", { name: "Cancel" }).click();
      await expectAt(0, first);
      await expect(saveOrder).toBeDisabled();
    } finally {
      // An empty order leaves every room to go by name again, for the tests that follow.
      expect(await send(page, "PUT", "/api/account/room_order", { roomIds: [] })).toBe(200);
    }
    await member.context().close();
  });
});
