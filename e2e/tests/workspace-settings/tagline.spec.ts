import type { Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";

/** A tagline as long as Ember takes, in everyday words. */
const TAGLINE = "Engines and tea for every soul";

/** The conversations beside a room, which have the workspace's name over them. */
const conversationsOf = (page: Page) => page.getByRole("complementary", { name: "Conversations" });

test.describe("Workspace tagline", () => {
  test("the administrator gives the workspace a tagline, which every tab's settings keep, then takes it away, while the conversations show the name alone", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const field = page.getByRole("textbox", { name: "Tagline" });
    await expect(field).toBeVisible();
    const otherTab = await page.context().newPage();
    await otherTab.goto("/account/edit");
    await expect(otherTab.getByRole("textbox", { name: "Tagline" })).toBeVisible();

    // A server kept from an earlier run may have one already.
    await field.fill(TAGLINE);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    // The other tab's settings follow, so saving there keeps it.
    await expect(otherTab.getByRole("textbox", { name: "Tagline" })).toHaveValue(TAGLINE);
    await otherTab.getByRole("button", { name: "Save changes" }).click();
    await expect(otherTab.getByRole("alert")).toHaveText("Changes saved.");
    // Back in a room, the conversations have the workspace's name alone: the tagline says nothing the list needs.
    for (const tab of [page, otherTab]) await tab.getByRole("link", { name: "Go Back" }).click();
    for (const tab of [page, otherTab]) {
      await expect(conversationsOf(tab).getByRole("heading", { level: 2 })).toBeVisible();
      await expect(conversationsOf(tab).getByText(TAGLINE)).toHaveCount(0);
    }

    await page.goto("/account/edit");
    await expect(field).toHaveValue(TAGLINE);
    await field.clear();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    // The other tab's settings follow at once.
    await otherTab.goto("/account/edit");
    await expect(otherTab.getByRole("textbox", { name: "Tagline" })).toHaveValue("");
  });
});
