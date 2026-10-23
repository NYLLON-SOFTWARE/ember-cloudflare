import { feature } from "@ember/parity";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";

/** A tagline as long as Ember takes, in everyday words. */
const TAGLINE = "Engines and tea for every soul";

/** The tagline right under the workspace's name, at the top of the conversations. */
const taglineOf = (page: Page) => page.getByRole("complementary", { name: "Conversations" }).locator("hgroup > h2 + p");

/** How many lines `text` takes up. */
const linesOf = (text: Locator) =>
  text.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((line) => Math.round(line.top))).size;
  });

test.describe(feature("accounts.tagline"), () => {
  test("the administrator gives the workspace a tagline, which every tab shows under its name, then takes it away", async ({ page }) => {
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
    for (const tab of [page, otherTab]) await expect(taglineOf(tab)).toHaveText(TAGLINE);
    // On one line in the sidebar's full 280px, as in a phone's drawer (mobile/accounts.spec.ts).
    expect(await linesOf(taglineOf(page))).toBe(1);

    await page.reload();
    await expect(field).toHaveValue(TAGLINE);
    await field.clear();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    for (const tab of [page, otherTab]) await expect(taglineOf(tab)).toHaveCount(0);
  });
});
