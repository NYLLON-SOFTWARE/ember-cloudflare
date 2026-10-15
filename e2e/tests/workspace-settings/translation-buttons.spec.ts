import { feature } from "@ember/parity";
import { expect, test } from "@playwright/test";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";

test.describe(feature("accounts.translation-buttons"), () => {
  test("the administrator shows translation buttons, which every page then has, and hides them again", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const hide = page.getByRole("switch", { name: "Hide translation buttons" });
    // A server kept from an earlier run may show them still.
    await expect(hide).toBeVisible();
    if (!(await hide.isChecked())) await hide.click();
    await expect(hide).toBeChecked();
    await expect(page.getByText("Translate", { exact: true })).toHaveCount(0);
    const otherTab = await page.context().newPage();
    await otherTab.goto("/account/edit");
    await expect(otherTab.getByRole("textbox", { name: "Workspace name" })).toBeVisible();

    // At once, with nothing said after, and in the other tab too, where ember-rust's waits for its next page.
    await hide.click();
    await expect(hide).not.toBeChecked();
    await expect(page.getByText("Translate", { exact: true })).toHaveCount(1);
    await expect(otherTab.getByText("Translate", { exact: true })).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The workspace name's globe, which lists what the field asks in seven languages.
    const globe = page.locator("summary", { hasText: "Translate" });
    await globe.click();
    const languages = page.locator("details[open] dl");
    await expect(languages.locator("dt")).toHaveText(["🇺🇸", "🇪🇸", "🇫🇷", "🇮🇳", "🇩🇪", "🇧🇷", "🇯🇵"]);
    await expect(languages.locator("dd").first()).toHaveText("Name this account");
    await page.keyboard.press("Escape");
    await expect(languages).toHaveCount(0);
    await globe.click();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(languages).toHaveCount(0);

    const signedOut = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const signIn = await signedOut.newPage();
    await signIn.goto("/");
    await expect(signIn.getByRole("textbox", { name: "Email address" })).toBeVisible();
    await expect(signIn.getByText("Translate", { exact: true })).toHaveCount(2);

    await hide.click();
    await expect(hide).toBeChecked();
    await expect(page.getByText("Translate", { exact: true })).toHaveCount(0);
    await expect(otherTab.getByText("Translate", { exact: true })).toHaveCount(0);
    await signIn.reload();
    await expect(signIn.getByRole("textbox", { name: "Email address" })).toBeVisible();
    await expect(signIn.getByText("Translate", { exact: true })).toHaveCount(0);
    await signedOut.close();
  });
});
