import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { ADMINISTRATOR, drawnPicture, shownPicture, useOwnAddress } from "../../fixtures";
import { expect, test } from "./fixtures";

const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

/** Opens your profile from the rail and waits for it to load. */
async function openYourProfile(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(/\/users\/me\/profile$/);
  await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
}

/**
 * Waits for the clock's next second, so a change after it gives an avatar a new address: its version
 * counts seconds, as ember-rust's does, and a browser keeps the picture at an address for 30 minutes.
 */
async function nextSecond(): Promise<void> {
  const second = Math.floor(Date.now() / 1000);
  await expect.poll(() => Math.floor(Date.now() / 1000), { intervals: [100] }).toBeGreaterThan(second);
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

test.describe(feature("users.avatar-upload"), () => {
  test("changes your avatar from your profile, everywhere it shows at once, and removes it", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await ada.send("Portrait check");
    // Ada's avatar on her message, as Grace sees it.
    const gracesView = grace.message("Portrait check").locator("img[aria-hidden=true]").first();

    const { page } = ada;
    await openYourProfile(page);
    const avatar = page.getByRole("img", { name: "Your avatar" });
    const remove = page.getByRole("button", { name: "Remove avatar" });
    const initials = await avatar.getAttribute("src");
    await expect(page.getByText("Choose a profile photo")).toBeVisible();
    await expect(remove).toHaveCount(0);

    await nextSecond();
    await page.getByLabel("Upload avatar").setInputFiles(await drawnPicture(page, "portrait.png", 1200, 800));
    await expect(page.getByRole("alert")).toHaveText("It may take up to 30 minutes to change everywhere.");
    await expect(avatar).toHaveAttribute("src", /^\/users\/[^/]+\/avatar\?v=\d{14}$/);
    await expect(avatar).not.toHaveAttribute("src", initials!);
    // The variant Ada's browser made of it, within 512×512.
    expect(await shownPicture(avatar)).toEqual({ type: "image/webp", width: 512, height: 341 });
    const uploaded = (await avatar.getAttribute("src"))!;
    await expect(gracesView).toHaveAttribute("src", uploaded);
    expect(await shownPicture(gracesView)).toEqual({ type: "image/webp", width: 512, height: 341 });

    await nextSecond();
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(avatar).not.toHaveAttribute("src", uploaded);
    expect(await shownPicture(avatar)).toMatchObject({ type: expect.stringMatching(/^image\/svg\+xml/) });
    await expect(gracesView).toHaveAttribute("src", (await avatar.getAttribute("src"))!);

    await page.reload();
    await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
    await expect(remove).toHaveCount(0);
    expect(await shownPicture(avatar)).toMatchObject({ type: expect.stringMatching(/^image\/svg\+xml/) });
  });
});
