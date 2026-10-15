import { feature } from "@ember/parity";
import { expect, test } from "@playwright/test";
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
