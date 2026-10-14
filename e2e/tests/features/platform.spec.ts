import { feature } from "@ember/parity";
import { expect, test, type Page } from "@playwright/test";

// These start signed out and need no rooms, so they use Playwright's own fixtures: with the app's,
// making a test's rooms would ask the API as the old browsers below, and get the upgrade page.

/** Chrome 119, a version short of what ember-rust allows. */
const OLD_CHROME = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.199 Safari/537.36";
/** Apple Messages fetching a link's preview: Safari 9's engine, naming the crawlers it stands in for. */
const APPLE_MESSAGES =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0";

const upgradeHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Upgrade to a supported web browser" });

test.describe(feature("platform.browser-support"), () => {
  test.describe("on an old browser", () => {
    test.use({ userAgent: OLD_CHROME });

    test("asks to upgrade instead of opening the app, naming the browsers that work", async ({ page }) => {
      await page.goto("/");
      await expect(page).toHaveTitle("Unsupported browser");
      await expect(upgradeHeading(page)).toBeVisible();
      await expect(page.getByText("Ember requires a modern web browser.")).toBeVisible();
      await expect(page.locator(".browser")).toHaveText(["Safari 17.2+", "Chrome 120+", "Firefox 121+", "Opera 104+"]);
      for (const logo of await page.locator(".browser img").all()) {
        await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
      }
    });

    test("asks wherever a link leads", async ({ page }) => {
      for (const path of ["/rooms/general", "/session/new", "/join/AAAA-BBBB-CCCC", "/first_run"]) {
        await page.goto(path);
        await expect(upgradeHeading(page)).toBeVisible();
      }
    });

    test("is dark when the app was left dark, or the device is", async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/");
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(28, 28, 28)");

      await page.evaluate(() => localStorage.setItem("ember:appearance", "light"));
      await page.reload();
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(250, 250, 250)");

      await page.emulateMedia({ colorScheme: "light" });
      await page.evaluate(() => localStorage.setItem("ember:appearance", "dark"));
      await page.reload();
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(28, 28, 28)");
    });
  });

  test.describe("in Apple Messages", () => {
    test.use({ userAgent: APPLE_MESSAGES });

    test("previews a link as Ember rather than as a warning", async ({ page }) => {
      await page.goto("/rooms/general");
      await expect(page).toHaveTitle("Ember");
      await expect(upgradeHeading(page)).toBeVisible();
    });
  });
});

test.describe(feature("platform.security-headers"), () => {
  test("pages come with Rails' default headers", async ({ page }) => {
    const response = await page.goto("/session/new");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Ember" })).toBeVisible();
    expect(response!.headers()).toMatchObject({
      "x-frame-options": "SAMEORIGIN",
      "x-xss-protection": "0",
      "x-content-type-options": "nosniff",
      "x-permitted-cross-domain-policies": "none",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
  });

  test("only the app itself can show it in a frame", async ({ page, baseURL }) => {
    const showInFrame = (src: string) =>
      page.evaluate((src) => document.body.append(Object.assign(document.createElement("iframe"), { src })), src);
    await page.goto("/up");
    await showInFrame("/session/new");
    await expect(page.frameLocator("iframe").getByRole("heading", { name: "Sign in to Ember" })).toBeVisible();

    // The same server by another name is another site to the browser.
    await page.goto(`${baseURL!.replace("127.0.0.1", "localhost")}/up`);
    const framed = page.waitForResponse(`${baseURL}/session/new`);
    await showInFrame(`${baseURL}/session/new`);
    expect((await framed).headers()["x-frame-options"]).toBe("SAMEORIGIN");
    await expect.poll(() => page.frames()[1]?.url()).toMatch(/^chrome-error:/);
  });
});

test.describe(feature("platform.version"), () => {
  test("pages say which version answered them", async ({ page, request }) => {
    const response = await page.goto("/session/new");
    const { version } = (await (await request.get("/api/bootstrap")).json()) as { version: string };
    expect(response!.headers()["x-version"]).toBe(version);
  });
});

test.describe(feature("platform.health"), () => {
  // Uptime checks come from anything, so /up answers even an old browser.
  test.use({ userAgent: OLD_CHROME });

  test("/up shows Rails' green page", async ({ page }) => {
    const response = await page.goto("/up");
    expect(response!.status()).toBe(200);
    expect(response!.headers()["x-version"]).toBeUndefined();
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 128, 0)");
  });

  test("/up.json says so in JSON", async ({ request }) => {
    const response = await request.get("/up.json");
    expect(response.headers()["content-type"]).toBe("application/json; charset=utf-8");
    expect(await response.json()).toEqual({ status: "up", timestamp: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) });
  });
});
