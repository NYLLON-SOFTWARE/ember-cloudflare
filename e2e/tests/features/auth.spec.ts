import { feature } from "@ember/parity";
import { expect, test } from "./fixtures";

test.describe(feature("auth.guest-sign-in"), () => {
  test("signs in with a display name and opens the first room", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join" })).toBeDisabled();

    await page.getByLabel("Your name").fill("  Ada Lovelace  ");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Ada Lovelace");
  });
});

test.describe(feature("auth.sessions"), () => {
  test("stays signed in across reloads", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.page.reload();
    await ada.connected();
    await expect(ada.page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Ada");
  });

  test("goes back to sign-in when the saved session is no good", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("ember:session", JSON.stringify({ user: { id: "x", name: "Mallory" }, token: "forged.token" })));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
  });
});

test.describe(feature("auth.sign-out"), () => {
  test("signs out from the profile menu and stays signed out", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.page.getByRole("button", { name: "Your profile" }).click();
    await expect(ada.page.getByRole("menu")).toContainText("Ada");
    await ada.page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(ada.page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();

    await ada.page.reload();
    await expect(ada.page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
  });
});
