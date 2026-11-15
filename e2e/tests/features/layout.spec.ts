import type { Locator, Page } from "@playwright/test";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { expect, test } from "./fixtures";

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
};

/** How far in from its left and right edges an element's content starts. */
const sides = (locator: Locator) => locator.evaluate((element) => [getComputedStyle(element).paddingLeft, getComputedStyle(element).paddingRight]);

/** How far the page scrolls sideways. */
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);


test.describe("Workspace layout", () => {
  test("puts the rail, the conversations and the room side by side on a desktop", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const rail = ada.page.getByRole("navigation", { name: "Workspace" });
    const rooms = ada.page.getByRole("region", { name: "Rooms" });
    const header = ada.page.getByRole("navigation", { name: "Page" });

    expect(await box(rail)).toMatchObject({ x: 0, width: 80, height: 800 });
    expect(await box(ada.page.getByRole("complementary", { name: "Conversations" }))).toMatchObject({ x: 80, width: 280, height: 800 });
    expect(await box(header)).toMatchObject({ x: 360, y: 0, height: 60, width: 920 });
    expect(await sides(header)).toEqual(["22px", "22px"]);
    const roomsBox = await box(rooms);
    expect(roomsBox.x).toBeGreaterThan(80);
    expect(roomsBox.x + roomsBox.width).toBeLessThanOrEqual(360);
    expect(await box(rail.getByRole("link", { name: "Home", exact: true }))).toMatchObject({ width: 56, height: 56 });
    await expect(ada.page.getByRole("button", { name: "Open conversations" })).toBeHidden();
    await expect(ada.composer()).toBeInViewport({ ratio: 1 });
  });

  test("keeps the desktop layout just above 900px wide", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 901, height: 700 } } });
    await expect(ada.page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    await expect(ada.page.getByRole("button", { name: "Open conversations" })).toBeHidden();
  });

  test("narrows the conversations to 230px from 901 to 1100px wide, and tightens the page's sides", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1100, height: 700 } } });
    const conversations = ada.page.getByRole("complementary", { name: "Conversations" });
    const header = ada.page.getByRole("navigation", { name: "Page" });
    const composer = ada.page.locator("footer").filter({ has: ada.composer() });
    for (const width of [1100, 1000, 901]) {
      await ada.page.setViewportSize({ width, height: 700 });
      expect(await box(conversations), `${width}px`).toMatchObject({ x: 80, width: 230 });
      expect(await box(header), `${width}px`).toMatchObject({ x: 310, width: width - 310 });
      expect(await sides(header)).toEqual(["18px", "18px"]);
      expect(await sides(conversations.locator(":scope > div"))).toEqual(["8px", "8px"]);
      expect(await sides(composer)).toEqual(["16px", "16px"]);
    }

    await ada.page.setViewportSize({ width: 1101, height: 700 });
    expect(await box(conversations)).toMatchObject({ x: 80, width: 280 });
    expect(await sides(header)).toEqual(["22px", "22px"]);
  });

  test("doesn't scroll sideways from 320 to 1440px wide, and keeps the composer on a short phone screen", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 320, height: 640 } } });
    for (const width of [320, 390, 768, 900, 901, 1100, 1440]) {
      await ada.page.setViewportSize({ width, height: 800 });
      expect(await overflow(ada.page), `${width}px`).toBeLessThanOrEqual(0);
    }
    await ada.page.setViewportSize({ width: 390, height: 420 });
    await expect(ada.composer()).toBeInViewport({ ratio: 1 });
  });

  test("scrolls a long page's content but never the layout around it, also when the address's fragment changes", async ({ members }) => {
    const ada = await members.signIn("Ada", { administrator: true, context: { viewport: { width: 1280, height: 800 } } });
    const header = ada.page.getByRole("navigation", { name: "Page" });
    const main = ada.page.getByRole("main");
    const membership = ada.page.getByRole("region", { name: "Membership" });
    // Both run past the window, with icon buttons far down them whose names only screen readers get:
    // the profile's ends with your sign-in link, and Membership's with the people, yourself among them.
    // Scrolling the page itself, as a mouse wheel over the header would, moves nothing, while a wheel
    // over their content scrolls it.
    for (const [path, shown] of [
      ["/users/me/profile", ada.page.getByRole("textbox", { name: "Use this link to login automatically on another device" })],
      ["/account/edit#membership-settings", membership.getByRole("link", { name: "My settings" })],
    ] as const) {
      await ada.page.goto(path);
      await expect(shown).toBeAttached();
      await ada.page.evaluate(() => window.scrollBy(0, 400));
      expect(await box(header), path).toMatchObject({ y: 0 });
      await main.hover();
      await ada.page.mouse.wheel(0, 400);
      await expect.poll(() => main.evaluate((element) => element.scrollTop), { message: path }).toBeGreaterThan(0);
      expect(await box(header), path).toMatchObject({ y: 0 });
    }

    // Going to another section by the address's fragment, as typing it in does, leaves the layout where it is too.
    await ada.page.evaluate(() => void (location.hash = "#community-settings"));
    await expect(ada.page.getByRole("heading", { name: "Basic community settings" })).toBeVisible();
    await ada.page.evaluate(() => void (location.hash = "#membership-settings"));
    await expect(membership).toBeVisible();
    await ada.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await box(header)).toMatchObject({ y: 0 });
  });

  test("uses Ember's palette and 14px text, light and dark", async ({ members }) => {
    const palettes = {
      light: { canvas: "rgb(255, 255, 255)", surface: "rgb(250, 250, 250)", hover: "rgb(242, 242, 242)", border: "rgb(229, 229, 229)", muted: "rgb(115, 115, 115)", ink: "rgb(23, 23, 23)" },
      dark: { canvas: "rgb(23, 23, 23)", surface: "rgb(28, 28, 28)", hover: "rgb(40, 40, 40)", border: "rgb(52, 52, 52)", muted: "rgb(163, 163, 163)", ink: "rgb(245, 245, 245)" },
    };
    for (const [colorScheme, colors] of Object.entries(palettes) as [keyof typeof palettes, (typeof palettes)["light"]][]) {
      const { page } = await members.signIn(colorScheme === "light" ? "Ada" : "Grace", { context: { colorScheme, viewport: { width: 1280, height: 800 } } });
      const header = page.getByRole("navigation", { name: "Page" });
      await expect(page.locator("body")).toHaveCSS("font-size", "14px");
      await expect(page.locator("body")).toHaveCSS("line-height", "21px");
      await expect(page.locator("body")).toHaveCSS("background-color", colors.surface);
      await expect(header).toHaveCSS("background-color", colors.canvas);
      await expect(header).toHaveCSS("border-bottom-color", colors.border);
      await expect(header.getByRole("heading", { level: 1 })).toHaveCSS("color", colors.ink);
      await expect(page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: "general" })).toHaveCSS("background-color", colors.hover);
      // The sections' headings, muted.
      await expect(page.getByRole("button", { name: "Rooms" })).toHaveCSS("color", colors.muted);
    }
  });
});

// At 900px wide and below, the conversations are Home's list, with the tab bar under it, rather than a
// drawer: mobile/navigation.spec.ts and the phone projects cover the tabs, Back and their sizes.
test.describe("Phone layout", () => {
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

  test("keeps the room, Home and the settings pages on screen at 320, 390 and 768px wide", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { context: phone });
    const tabs = ada.page.getByRole("navigation", { name: "Tabs" });
    for (const width of [320, 390, 768]) {
      await ada.page.setViewportSize({ width, height: 844 });
      await ada.page.goto(`/rooms/${rooms.general.id}`);
      await expect(ada.composer()).toBeInViewport({ ratio: 1 });
      expect(await overflow(ada.page), `${width}px room`).toBeLessThanOrEqual(0);

      await ada.page.goto("/");
      await expect(ada.page.getByRole("main").getByRole("link", { name: "general" })).toBeVisible();
      await expect(tabs.getByRole("link", { name: "Home", exact: true })).toBeInViewport({ ratio: 1 });
      expect(await overflow(ada.page), `${width}px Home`).toBeLessThanOrEqual(0);

      for (const [path, title] of [
        ["/account/edit", "Basic community settings"],
        ["/rooms/opens/new", "New room"],
      ] as const) {
        await ada.page.goto(path);
        await expect(ada.page.getByRole("heading", { level: 1, name: title })).toBeVisible();
        expect(await overflow(ada.page), `${width}px ${path}`).toBeLessThanOrEqual(0);
        expect((await box(ada.page.getByRole("main"))).width, `${width}px ${path}`).toBeLessThanOrEqual(width);
      }
    }
  });
});

test.describe("Landmarks and names", () => {
  test("starts Tab at Skip to main content, shown under the header's start, which focuses the main content", async ({ members, rooms }) => {
    // The composer takes focus as its editor's code arrives, unless you've moved it, so Tab would start there
    // when the code came first. Holding the code until Tab has moved focus keeps that from racing the test.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const ada = await members.signIn("Ada", {
      context: { viewport: { width: 1280, height: 800 } },
      beforeOpen: async (page) => {
        await page.route(/\/assets\/rich-text-editor-[^/]+\.js$/, async (route) => {
          await held;
          await route.continue();
        });
      },
    });
    const skip = ada.page.getByRole("link", { name: "Skip to main content" });
    expect((await box(skip)).width).toBeLessThanOrEqual(1);
    await ada.page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    release();
    await expect(ada.composer()).toBeVisible();
    await expect(skip).toBeFocused();
    expect(await box(skip)).toMatchObject({ y: 64 });
    await expect(skip).toBeInViewport({ ratio: 1 });

    await ada.page.keyboard.press("Enter");
    await expect(ada.page.getByRole("main")).toBeFocused();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await ada.page.keyboard.press("Tab");
    expect(await ada.page.evaluate(() => document.activeElement?.closest("main") != null)).toBe(true);
  });
});

test.describe("Community settings page", () => {
  test("puts community settings' links in a 244px column beside the page, in a strip under the header at 900px and below, and each icon over its label at 500px and below", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const links = page.getByRole("navigation", { name: "Community settings" });
    const membership = links.getByRole("link", { name: "Membership" });
    const [icon, label] = [membership.locator("svg"), membership.getByText("Membership")];

    // Where the conversations would be, under the header, which spans both.
    expect(await box(page.getByRole("navigation", { name: "Page" }))).toMatchObject({ x: 80, y: 0, width: 1200, height: 60 });
    expect(await box(links)).toMatchObject({ x: 80, y: 60, width: 244, height: 740 });
    expect(await box(page.getByRole("main"))).toMatchObject({ x: 324, y: 60, width: 956 });

    for (const width of [900, 501, 500, 320]) {
      await page.setViewportSize({ width, height: 800 });
      expect(await box(links), `${width}px`).toMatchObject({ x: 0, width });
      // The strip scrolls sideways when its links don't fit, and the page doesn't.
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(0);
      const [iconBox, labelBox] = [await box(icon), await box(label)];
      if (width > 500) expect(iconBox.x + iconBox.width, `${width}px`).toBeLessThanOrEqual(labelBox.x);
      else expect(iconBox.y + iconBox.height, `${width}px`).toBeLessThanOrEqual(labelBox.y);
    }
  });
});

test.describe("Empty room", () => {
  test("welcomes people to a room nobody has written in", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.page.getByRole("heading", { name: "Welcome to #general" })).toBeVisible();
    // Its heading alone: the line under it is for a sub-room's parent, with no filler in its place.
    await expect(ada.page.getByText("This is the very beginning of the room. Say hello!")).toHaveCount(0);
  });
});
