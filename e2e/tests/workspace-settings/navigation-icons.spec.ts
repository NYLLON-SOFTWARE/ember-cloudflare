import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ICON_CATALOG_LOADED, signInAsAdministrator, useOwnAddress } from "../../fixtures";

/** The rail's Home link. */
const homeOf = (page: Page) => page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Home", exact: true });

test.describe(feature("accounts.navigation-icons"), () => {
  test("the administrator gives Home a coffee cup, which every tab's rail shows at once, then gives Home its own back", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const picker = page.getByRole("button", { name: "Choose Home icon" });
    await expect(picker).toBeVisible();
    const otherTab = await page.context().newPage();
    await otherTab.goto("/");
    await expect(homeOf(otherTab)).toBeVisible();

    await picker.click();
    const dialog = page.getByRole("dialog", { name: "Choose a navigation icon" });
    await expect(dialog.getByRole("status")).toHaveText("3,540 icons · 72 shown", ICON_CATALOG_LOADED);
    await dialog.getByRole("searchbox", { name: "Search icons" }).fill("coffee");
    await dialog.getByRole("button", { name: "Use Coffee Cup icon from Iconoir" }).click();
    await dialog.getByRole("button", { name: "Use icon", exact: true }).click();
    await expect(picker).toContainText("Coffee Cup · Iconoir");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    for (const tab of [page, otherTab]) await expect(homeOf(tab).locator('[data-icon="iconoir:regular:coffee-cup"]')).toBeVisible();
    expect((await page.request.get("/iconoir/icons/regular/coffee-cup.svg")).headers()["content-type"]).toContain("image/svg+xml");

    // Back to its own, as the other tests expect it.
    await picker.click();
    await dialog.getByRole("button", { name: "Use default icon" }).click();
    await dialog.getByRole("button", { name: "Use icon", exact: true }).click();
    await expect(picker).toContainText("Default icon");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    for (const tab of [page, otherTab]) await expect(homeOf(tab).locator(".iconoir-home")).toBeVisible();
  });
});
