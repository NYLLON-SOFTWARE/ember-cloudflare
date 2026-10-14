import { feature } from "@ember/parity";
import type { Bootstrap } from "@ember/protocol";
import { expect, test } from "@playwright/test";

// The test server starts empty, so this sets it up through the Set up Ember page before any other
// suite runs; they then find the workspace, All Talk and its administrator there.

test.describe(feature("auth.first-run"), () => {
  test("the first visitor sets up Ember and lands in All Talk as its administrator", async ({ page, request }) => {
    const { setup } = (await (await request.get("/api/bootstrap")).json()) as Bootstrap;
    test.skip(setup === "complete", "The test server was set up by an earlier run, which reuseExistingServer kept");

    await page.goto("/");
    await expect(page).toHaveURL(/\/first_run$/);
    await expect(page).toHaveTitle("Set up Ember");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up Ember");
    await expect(page.getByLabel("Name")).toBeFocused();

    const password = page.getByLabel("Password", { exact: true });
    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email address").fill("ada@example.com");
    // Eight UTF-16 units satisfy the browser's minlength, but the server counts four characters.
    await password.fill("🔐🔐🔐🔐");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Password must be at least 8 characters.");
    await expect(password).toBeFocused();
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace");

    await password.fill("correct horse battery");
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All Talk");
    await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Ada Lovelace");
    // Setup took the page's place, so Back doesn't return to it.
    expect(await page.evaluate(() => history.length)).toBe(2);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All Talk");
    // Once it's set up, setup sends everyone home.
    await page.goto("/first_run");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All Talk");
    expect(new URL(page.url()).pathname).not.toBe("/first_run");
    const again = await request.post("/api/first_run", { data: { name: "Mallory", emailAddress: "mallory@example.com", password: "12345678" } });
    expect(again.status()).toBe(409);
  });
});
