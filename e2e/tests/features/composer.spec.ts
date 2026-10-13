import { feature } from "@ember/parity";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

const box = async (locator: Locator) => {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("Not visible");
  return rect;
};

test.describe(feature("composer.layout"), () => {
  test("is a card at least 108px tall, with the text on top and a round Send button below", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const field = ada.composer();
    const card = field.locator("..");
    const send = ada.page.getByRole("button", { name: "Send" });
    await expect(field).toHaveAttribute("placeholder", "Message #general");

    expect((await box(card)).height).toBeGreaterThanOrEqual(108);
    expect(parseFloat(await card.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThan(0);
    const fieldBox = await box(field);
    const sendBox = await box(send);
    expect(sendBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height);
    expect(sendBox.width).toBe(sendBox.height);
    expect(parseFloat(await send.evaluate((el) => getComputedStyle(el).borderTopLeftRadius))).toBeGreaterThanOrEqual(sendBox.width / 2);
  });

  test("grows with the text up to a third of the window", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    const field = ada.composer();
    const empty = (await box(field)).height;
    await field.fill("A line\n".repeat(3));
    expect((await box(field)).height).toBeGreaterThan(empty);
    // min(32dvh, 300px) of an 800px window
    await field.fill("A line\n".repeat(40));
    expect((await box(field)).height).toBe(256);
  });

  test("is at least 100px tall on phones", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    expect((await box(ada.composer().locator(".."))).height).toBeGreaterThanOrEqual(100);
  });
});

test.describe(feature("composer.send"), () => {
  test("sends on Enter, starts a new line on Shift+Enter and never sends a blank message", async ({ members }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    await ada.composer().fill("   ");
    await ada.composer().press("Enter");
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();

    await ada.composer().fill("First line");
    await ada.composer().press("Shift+Enter");
    await ada.composer().pressSequentially("second line");
    await expect(ada.composer()).toHaveValue("First line\nsecond line");
    await ada.composer().press("Enter");

    await expect(grace.message("First line")).toContainText("second line");
    await expect(grace.page.getByRole("article")).toHaveCount(1);
    await expect(ada.composer()).toHaveValue("");
    await expect(ada.composer()).toBeFocused();
    await expect(ada.page.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("starts a new line on Enter on a touch screen, where only the Send button sends", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: phone });
    await ada.composer().tap();
    await ada.page.keyboard.type("First line");
    await ada.page.keyboard.press("Enter");
    await ada.page.keyboard.type("second line");
    await expect(ada.composer()).toHaveValue("First line\nsecond line");
    await expect(ada.page.getByRole("article")).toHaveCount(0);

    await ada.page.getByRole("button", { name: "Send" }).tap();
    await expect(ada.message("First line")).toContainText("second line");
    await expect(ada.composer()).toBeFocused();
  });
});

