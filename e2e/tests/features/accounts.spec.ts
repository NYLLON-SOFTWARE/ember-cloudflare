import { feature } from "@ember/parity";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { expect, test } from "./fixtures";

// Renaming the workspace changes every other test's pages, so the workspace-settings project does
// that on a server of its own. These save the name as it is.

test.describe(feature("accounts.settings-page"), () => {
  test("a member sees the workspace's name and Ember's version, with nothing to change", async ({ members }) => {
    const grace = await members.signIn("Grace Hopper");
    await grace.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Workspace" }).click();
    await expect(grace.page.getByRole("heading", { level: 1 })).toHaveText("Workspace settings");
    await expect(grace.page.getByRole("main").getByRole("heading", { level: 2, name: "Ember", exact: true })).toBeVisible();
    await expect(grace.page.getByRole("textbox", { name: "Workspace name" })).toHaveCount(0);
    await expect(grace.page.getByText(/^Ember™ version \S+$/)).toBeVisible();
  });
});

test.describe(feature("accounts.name"), () => {
  test("the administrator saves the workspace's name from the Admin page, which says Changes saved.", async ({ page }) => {
    await useOwnAddress(page);
    await page.goto("/session/new");
    await signInAsAdministrator(page);
    await expect(page.getByRole("textbox", { name: /^Message #/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Admin" }).click();

    const name = page.getByRole("textbox", { name: "Workspace name" });
    await expect(name).toHaveValue("Ember");
    await expect(name).not.toBeFocused();
    const saved = page.waitForResponse((response) => response.url().endsWith("/api/account") && response.request().method() === "PATCH");
    await name.press("Enter");
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    await expect(page).toHaveURL(/\/account\/edit$/);
  });
});
