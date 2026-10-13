import { expect, test } from "./fixtures";

test("the sign-in screen fits the phone", async ({ page, screenIsFine }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
  await screenIsFine();
});

test("you can sign in with taps", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Your name").tap();
  await page.keyboard.type("Pat on a phone");
  await page.getByRole("button", { name: "Join" }).tap();
  await expect(page.getByRole("textbox", { name: /^Message #/ })).toBeVisible();
});

test("the page keeps zoom and lets the keyboard resize it", async ({ page }) => {
  await page.goto("/");
  const viewport = await page.locator("meta[name=viewport]").getAttribute("content");
  const settings = Object.fromEntries(viewport!.split(",").map((part) => part.trim().split("=") as [string, string]));

  expect(settings).toMatchObject({ width: "device-width", "viewport-fit": "cover" });
  expect(Number(settings["initial-scale"])).toBe(1);
  // Android Chrome then shrinks the page above the keyboard instead of covering the composer,
  // as ember-rust's layouts/application.html asks.
  expect(settings["interactive-widget"]).toBe("resizes-content");
  // Pinch zoom must keep working (WCAG 1.4.4).
  expect(settings).not.toHaveProperty("maximum-scale");
  expect(settings).not.toHaveProperty("user-scalable");
});
