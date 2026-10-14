import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { expect, test, type Member } from "./fixtures";

const isDark = (page: Page) => page.locator("html").evaluate((html) => html.classList.contains("dark"));
const themeColors = (page: Page) => page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((meta) => (meta as HTMLMetaElement).content));

async function choose(member: Member, appearance: "Light" | "Dark" | "System") {
  await member.page.getByRole("button", { name: "Appearance" }).click();
  await member.page.getByRole("menuitemradio", { name: appearance }).click();
  await expect(member.page.getByRole("menu")).toHaveCount(0);
}

test.describe(feature("ui.appearance"), () => {
  test("switches to Dark and keeps it, applied before the app has even loaded", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { colorScheme: "light" } });
    expect(await isDark(ada.page)).toBe(false);
    await expect(ada.page.locator("body")).toHaveCSS("background-color", "rgb(250, 250, 250)");

    await choose(ada, "Dark");
    expect(await isDark(ada.page)).toBe(true);
    await expect(ada.page.locator("body")).toHaveCSS("background-color", "rgb(28, 28, 28)");
    await ada.page.getByRole("button", { name: "Appearance" }).click();
    await expect(ada.page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await ada.page.keyboard.press("Escape");

    // With the app's scripts blocked, only the inline script in index.html can set the theme.
    await ada.page.route("**/assets/*.js", (route) => route.abort());
    await ada.page.reload();
    await expect(ada.page.locator("#root")).toBeEmpty();
    expect(await isDark(ada.page)).toBe(true);
  });

  test("follows the device's setting on System, including when it changes", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { colorScheme: "dark" } });
    expect(await isDark(ada.page)).toBe(true);

    await ada.page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => isDark(ada.page)).toBe(false);

    await choose(ada, "Dark");
    await choose(ada, "System");
    expect(await isDark(ada.page)).toBe(false);
    await ada.page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => isDark(ada.page)).toBe(true);
  });

  test("Light overrides a dark device setting", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { colorScheme: "dark" } });
    await choose(ada, "Light");
    expect(await isDark(ada.page)).toBe(false);
    await ada.page.reload();
    await ada.connected();
    expect(await isDark(ada.page)).toBe(false);
  });

  test("colors the browser around the page to match, from the moment it loads", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { colorScheme: "dark" } });
    expect(await themeColors(ada.page)).toEqual(["#171717", "#171717"]);
    await choose(ada, "Light");
    expect(await themeColors(ada.page)).toEqual(["#ffffff", "#ffffff"]);

    // With the app's scripts blocked, only the inline script in index.html can set it.
    await ada.page.route("**/assets/*.js", (route) => route.abort());
    await ada.page.reload();
    await expect(ada.page.locator("#root")).toBeEmpty();
    expect(await themeColors(ada.page)).toEqual(["#ffffff", "#ffffff"]);
  });

  test("keeps every open tab in step", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { colorScheme: "light" } });
    const otherTab = await ada.page.context().newPage();
    await otherTab.goto("/");
    await expect(otherTab.getByRole("button", { name: "Appearance" })).toBeVisible();

    await choose(ada, "Dark");
    await expect.poll(() => isDark(otherTab)).toBe(true);
    await choose(ada, "System");
    await expect.poll(() => isDark(otherTab)).toBe(false);
  });
});
