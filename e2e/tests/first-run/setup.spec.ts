import { feature } from "@ember/parity";
import type { Bootstrap } from "@ember/protocol";
import { expect, test } from "@playwright/test";
import { ADMINISTRATOR, drawnPicture, shownPicture } from "../../fixtures";

// The test server starts empty, so this sets it up through the Set up Ember page before any other
// suite runs; they then find the workspace, its general and random rooms, and its administrator there.

test.describe(feature("auth.first-run"), () => {
  test("the first visitor sets up Ember and lands in general as its administrator", async ({ page, request }) => {
    const { setup } = (await (await request.get("/api/bootstrap")).json()) as Bootstrap;
    test.skip(setup === "complete", "The test server was set up by an earlier run, which reuseExistingServer kept");

    await page.goto("/");
    await expect(page).toHaveURL(/\/first_run$/);
    await expect(page).toHaveTitle("Set up Ember");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up Ember");
    await expect(page.getByLabel("Name")).toBeFocused();
    // With no header to show it under, Skip to main content shows at the page's top left, as basecoat's does.
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await skip.focus();
    expect(await skip.boundingBox()).toMatchObject({ x: 8, y: 8 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();

    const password = page.getByLabel("Password", { exact: true });
    const preview = page.getByRole("img", { name: "Avatar preview" });
    await page.getByLabel("Upload profile image (optional)").setInputFiles(await drawnPicture(page, "portrait.png", 640, 960));
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await page.getByLabel("Name").fill(ADMINISTRATOR.name);
    await page.getByLabel("Email address").fill(ADMINISTRATOR.emailAddress);
    // Eight UTF-16 units satisfy the browser's minlength, but the server counts four characters.
    await password.fill("🔐🔐🔐🔐");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("alert")).toHaveText("Password must be at least 8 characters.");
    await expect(password).toBeFocused();
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Name")).toHaveValue(ADMINISTRATOR.name);
    // The photo stays chosen too.
    await expect(preview).toHaveAttribute("src", /^blob:/);

    await password.fill(ADMINISTRATOR.password);
    await page.getByRole("button", { name: "Show password" }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(page).toHaveURL(/\/rooms\/[^/]+$/);
    await expect(page.getByRole("link", { name: "Your profile" })).toHaveAttribute("title", ADMINISTRATOR.name);
    // Their avatar is the variant their browser made of the photo, within 512×512.
    expect(await shownPicture(page.getByRole("link", { name: "Your profile" }).locator("img"))).toEqual({ type: "image/webp", width: 341, height: 512 });
    // Setup made the rooms general and random, and nothing else.
    const rooms = page.getByRole("region", { name: "Rooms" }).getByRole("link");
    await expect(rooms).toHaveCount(2);
    await expect(rooms).toContainText(["general", "random"]);
    // general, the first room, welcomes them with the link that invites everyone else.
    await expect(page.getByRole("heading", { level: 2, name: "Welcome to Ember" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Share to invite more people" })).toHaveValue(/\/join\/[A-Za-z\d]{4}-[A-Za-z\d]{4}-[A-Za-z\d]{4}$/);
    // Setup took the page's place, so Back doesn't return to it.
    expect(await page.evaluate(() => history.length)).toBe(2);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    // Once it's set up, setup sends everyone home.
    await page.goto("/first_run");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    expect(new URL(page.url()).pathname).not.toBe("/first_run");
    const again = await request.post("/api/first_run", { data: { name: "Mallory", emailAddress: "mallory@example.com", password: "12345678" } });
    expect(again.status()).toBe(409);
  });
});
