import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { ADMINISTRATOR, useOwnAddress } from "../../fixtures";
import { expect, test } from "./fixtures";

const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

/** Opens your profile from the rail and waits for it to load. */
async function openYourProfile(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(/\/users\/me\/profile$/);
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
}

test.describe(feature("users.profile"), () => {
  test("saves your name, email address, password and bio, and everyone's open pages show the new name at once", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await ada.send("Hello from Ada");
    await expect(grace.message("Hello from Ada")).toContainText(ada.name);

    const { page } = ada;
    await openYourProfile(page);
    await expect(page).toHaveTitle(ada.name);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(ada.name);
    // Someone who joined with just a name has no email address or bio yet.
    await expect(page.getByLabel("Email address")).toHaveValue("");
    await expect(page.getByLabel("Bio")).toHaveValue("");

    const newName = unique("Ada King");
    const emailAddress = `ada-${crypto.randomUUID()}@example.com`;
    await page.getByLabel("Name", { exact: true }).fill(newName);
    await page.getByLabel("Email address").fill(emailAddress);
    await page.getByLabel("New password").fill("difference engine");
    await page.getByLabel("Bio").fill("Wrote the first program");
    await page.getByRole("button", { name: "Save changes" }).click();
    // The flash's check, read as "Changes saved".
    await expect(page.getByRole("alert")).toHaveText("Changes saved");
    await expect(page.getByLabel("New password")).toHaveValue("");
    await expect(page).toHaveTitle(newName);
    await expect(page.getByRole("link", { name: "Your profile" })).toHaveAttribute("title", newName);
    await expect(grace.message("Hello from Ada")).toContainText(newName);

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(newName);
    await expect(page.getByLabel("Email address")).toHaveValue(emailAddress);
    await expect(page.getByLabel("Bio")).toHaveValue("Wrote the first program");

    // The email address and password sign them in once they log out.
    await useOwnAddress(page);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/session\/new$/);
    await page.getByLabel("Email address").fill(emailAddress);
    await page.getByLabel("Password").fill("difference engine");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("link", { name: "Your profile" })).toHaveAttribute("title", newName);
  });

  test("says when someone else has the email address, saving nothing", async ({ members }) => {
    const { page } = await members.signIn("Grace");
    await openYourProfile(page);
    await page.getByLabel("Email address").fill(ADMINISTRATOR.emailAddress);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("That email address has an account already");
    await expect(page.getByLabel("Email address")).toHaveValue(ADMINISTRATOR.emailAddress);

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
    await expect(page.getByLabel("Email address")).toHaveValue("");
  });

  test("goes back to the room it was opened from, or home when opened by its address", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    await openYourProfile(ada.page);
    await ada.page.getByRole("link", { name: "Go Back" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await ada.connected();

    await ada.page.goto("/users/me/profile");
    await expect(ada.page.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/");
  });
});
