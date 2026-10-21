import { feature } from "@ember/parity";
import { expect, test } from "../../fixtures";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";

test.describe(feature("accounts.name"), () => {
  test("the administrator renames the workspace, and every page shows the new name", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workspace settings");
    await expect(page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");

    const name = page.getByRole("textbox", { name: "Workspace name" });
    // A server kept from an earlier run has been renamed already.
    const renamed = (await name.inputValue()) === "Analytical Engines" ? "Difference Engines" : "Analytical Engines";
    await name.fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    await expect(page.getByRole("complementary", { name: "Conversations" }).getByRole("heading", { level: 2 })).toHaveText(renamed);
    await expect(page.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", renamed);

    await page.reload();
    await expect(name).toHaveValue(renamed);
    const signedOut = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const signIn = await signedOut.newPage();
    await signIn.goto("/");
    await expect(signIn.getByRole("heading", { level: 1 })).toHaveText(`Sign in to ${renamed}`);
    await signedOut.close();
  });
});
