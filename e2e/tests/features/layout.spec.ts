import { feature } from "@ember/parity";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
};

test.describe(feature("ui.layout"), () => {
  test("puts the rail, the conversations and the room side by side on a desktop", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const rail = ada.page.getByRole("navigation", { name: "Workspace" });
    const rooms = ada.page.getByRole("region", { name: "Rooms" });
    const header = ada.page.locator("header");

    expect(await box(rail)).toMatchObject({ x: 0, width: 80, height: 800 });
    expect(await box(header)).toMatchObject({ x: 360, y: 0, height: 60, width: 920 });
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

  test("doesn't scroll sideways on a phone", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 320, height: 640 } } });
    const overflow = await ada.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(ada.composer()).toBeInViewport({ ratio: 1 });
  });
});

test.describe(feature("ui.mobile-drawer"), () => {
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

  test("moves the conversations into a drawer at 899px wide and below", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 899, height: 700 } } });
    await expect(ada.page.getByRole("navigation", { name: "Workspace" })).toBeHidden();
    expect(await box(ada.page.locator("header"))).toMatchObject({ x: 0, height: 56 });
    expect(await box(ada.page.getByRole("button", { name: "Open conversations" }))).toMatchObject({ width: 44, height: 44 });
  });

  test("opens the drawer from the header and closes it on choosing a room", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    const open = ada.page.getByRole("button", { name: "Open conversations" });
    await expect(open).toHaveAttribute("aria-expanded", "false");
    await open.click();
    const drawer = ada.page.getByRole("dialog", { name: "Conversations" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("navigation", { name: "Workspace" })).toBeVisible();
    // While the drawer is open, everything behind it is hidden from assistive tech, this button too.
    await expect(ada.page.getByRole("button", { name: "Open conversations", includeHidden: true })).toHaveAttribute("aria-expanded", "true");

    await drawer.getByRole("region", { name: "Rooms" }).getByRole("link", { name: /random/ }).click();
    await expect(drawer).toHaveCount(0);
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
  });

  test("closes the drawer with Escape, the close button or a tap outside, giving focus back to its button", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    const open = ada.page.getByRole("button", { name: "Open conversations" });
    const drawer = ada.page.getByRole("dialog", { name: "Conversations" });

    await open.click();
    await expect(drawer).toBeVisible();
    await ada.page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await drawer.getByRole("button", { name: "Close conversations" }).click();
    await expect(drawer).toHaveCount(0);
    await expect(open).toBeFocused();

    await open.click();
    await expect(drawer).toBeVisible();
    // Radix starts listening for presses outside a moment after the drawer appears, so press once it
    // has slid in, as a person would.
    await drawer.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await ada.page.mouse.click(380, 400);
    await expect(drawer).toHaveCount(0);
  });

  test("closes the drawer when the window widens past 900px, leaving the page usable", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 899, height: 700 } } });
    await ada.page.getByRole("button", { name: "Open conversations" }).click();
    await expect(ada.page.getByRole("dialog", { name: "Conversations" })).toBeVisible();

    await ada.page.setViewportSize({ width: 1000, height: 700 });
    await expect(ada.page.getByRole("dialog", { name: "Conversations" })).toHaveCount(0);
    await expect(ada.page.locator("[data-slot=sheet-overlay]")).toHaveCount(0);
    await ada.composer().click();
    await expect(ada.composer()).toBeFocused();

    // Narrowing again doesn't bring it back.
    await ada.page.setViewportSize({ width: 899, height: 700 });
    await expect(ada.page.getByRole("button", { name: "Open conversations" })).toHaveAttribute("aria-expanded", "false");
    await expect(ada.page.getByRole("dialog", { name: "Conversations" })).toHaveCount(0);
  });

  test("keeps keyboard focus inside the open drawer", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    await ada.page.getByRole("button", { name: "Open conversations" }).click();
    const drawer = ada.page.getByRole("dialog", { name: "Conversations" });
    await expect(drawer).toBeVisible();
    for (let i = 0; i < 20; i++) {
      await ada.page.keyboard.press("Tab");
      expect(await ada.page.evaluate(() => document.activeElement?.closest("[role=dialog]") != null)).toBe(true);
    }
  });

  test("makes every row and button in the drawer at least 44px tall", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    await ada.page.getByRole("button", { name: "Open conversations" }).click();
    const drawer = ada.page.getByRole("dialog", { name: "Conversations" });
    await expect(drawer).toBeVisible();
    const controls = await drawer.locator("a, button").all();
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      const name = (await control.getAttribute("aria-label")) ?? (await control.innerText());
      expect((await box(control)).height, name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe(feature("ui.empty-room"), () => {
  test("welcomes people to a room nobody has written in", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.page.getByRole("heading", { name: "Welcome to #general" })).toBeVisible();
    await expect(ada.page.getByText("This is the very beginning of the room. Say hello!")).toBeVisible();
  });
});
