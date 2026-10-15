import { feature } from "@ember/parity";
import { expect, test, type Page } from "@playwright/test";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { join } from "./fixtures";

test.describe(feature("accounts.roles"), () => {
  test("the administrator makes someone an administrator, and a member again, and that person's pages follow at once", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const people = page.getByRole("list", { name: "People" });
    // Their own crown can't be pressed, so there's always an administrator.
    await expect(people.getByRole("listitem").filter({ hasText: "Ada Lovelace" }).getByRole("checkbox", { name: "Role: Administrator" })).toBeDisabled();

    // A server kept from an earlier run has had people join already.
    const name = `Grace ${crypto.randomUUID().slice(0, 8)}`;
    const grace = await join(browser, baseURL!, await page.getByRole("textbox", { name: "Share to invite more people" }).inputValue(), name);
    const rail = grace.getByRole("navigation", { name: "Workspace" });
    await rail.getByRole("link", { name: "Workspace" }).click();
    await expect(grace.getByRole("list", { name: "People" }).getByRole("listitem").filter({ hasText: name })).toBeVisible();
    await expect(grace.getByRole("checkbox")).toHaveCount(0);

    // The administrator's page lists them once it loads again, as ember-rust's does.
    await page.reload();
    const row = people.getByRole("listitem").filter({ hasText: name });
    await expect(row.getByRole("checkbox", { name: "Role: Member" })).not.toBeChecked();
    await row.locator("label").click();
    await expect(row.getByRole("checkbox", { name: "Role: Administrator" })).toBeChecked();

    // Their page follows without being loaded again: the rail's Admin, the name to change, and crowns.
    await expect(rail.getByRole("link", { name: "Admin" })).toBeVisible();
    await expect(grace.getByRole("textbox", { name: "Workspace name" })).toBeVisible();
    await expect(grace.getByRole("list", { name: "People" }).getByRole("listitem").filter({ hasText: name }).getByRole("checkbox")).toBeDisabled();

    await page.reload();
    await expect(row.getByRole("checkbox", { name: "Role: Administrator" })).toBeChecked();
    await row.locator("label").click();
    await expect(row.getByRole("checkbox", { name: "Role: Member" })).not.toBeChecked();
    await expect(rail.getByRole("link", { name: "Workspace" })).toBeVisible();
    await expect(grace.getByRole("textbox", { name: "Workspace name" })).toHaveCount(0);
    await expect(grace.getByRole("checkbox")).toHaveCount(0);
    await grace.context().close();
  });
});

test.describe(feature("accounts.remove-person"), () => {
  test("the administrator removes someone after asking, and that person's pages go to sign in at once", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const people = page.getByRole("list", { name: "People" });
    await expect(people.getByRole("listitem").filter({ hasText: "Ada Lovelace" }).getByRole("button", { name: /^Delete/ })).toHaveCount(0);

    const name = `Grace ${crypto.randomUUID().slice(0, 8)}`;
    const grace = await join(browser, baseURL!, await page.getByRole("textbox", { name: "Share to invite more people" }).inputValue(), name);
    // A tab showing a page that isn't a room, which only the workspace socket tells.
    const graceSettings = await grace.context().newPage();
    await graceSettings.goto("/account/edit");
    await expect(graceSettings.getByRole("list", { name: "People" }).getByRole("listitem").filter({ hasText: name })).toBeVisible();

    await page.reload();
    const row = people.getByRole("listitem").filter({ hasText: name });
    page.once("dialog", (dialog) => void dialog.dismiss());
    await row.getByRole("button", { name: `Delete ${name}` }).click();
    await expect(row.getByRole("button", { name: `Delete ${name}` })).toBeEnabled();

    const asked = new Promise<string>((resolve) =>
      page.once("dialog", (dialog) => {
        resolve(dialog.message());
        void dialog.accept();
      }),
    );
    await row.getByRole("button", { name: `Delete ${name}` }).click();
    expect(await asked).toBe("Are you sure you want to permanently remove this person from the account? This can’t be undone.");
    await expect(row).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // The sign-in page names the workspace, which another test here may have renamed.
    const signIn = (tab: Page) => tab.getByRole("heading", { level: 1, name: /^Sign in to / });
    for (const tab of [grace, graceSettings]) {
      await expect(signIn(tab)).toBeVisible();
      await expect(tab).toHaveURL(/\/session\/new$/);
    }
    await graceSettings.goto("/account/edit");
    await expect(signIn(graceSettings)).toBeVisible();
    await page.reload();
    await expect(people.getByRole("listitem").filter({ hasText: "Ada Lovelace" })).toBeVisible();
    await expect(row).toHaveCount(0);
    await grace.context().close();
  });
});
