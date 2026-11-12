import type { Locator, Page } from "@playwright/test";
import { editorField, openRoom, signInAs } from "../../fixtures";
import { expect, hasPhoneLayout, REACTION_PILLS, tabBar, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

/** Rests a finger on `target` until `opens` shows, as a long press does, then lifts it. Playwright's touchscreen only taps. */
async function longPress(target: Locator, opens: Locator) {
  await target.scrollIntoViewIfNeeded();
  // A finger rests on what's still, as a page that scrolls under it, as one settling after the keyboard
  // goes does, cancels the press.
  let box = { x: NaN, y: NaN, width: 0, height: 0 };
  await expect
    .poll(async () => {
      const [before, now] = [box, (box = (await target.boundingBox())!)];
      return now.x === before.x && now.y === before.y;
    }, { intervals: [250] })
    .toBe(true);
  const cdp = await target.page().context().newCDPSession(target.page());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(opens).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/**
 * Opens a message's actions as a finger does: a long press on its text in the phone layout, which opens
 * them in a sheet, or Message options on a wider touch screen, which opens them beside it.
 */
async function openActions(page: Page, message: Locator, text: string): Promise<Locator> {
  if (!hasPhoneLayout(page)) {
    await message.getByRole("button", { name: "Message options" }).tap();
    return page.getByRole("group", { name: "Message actions" });
  }
  const sheet = page.getByRole("dialog", { name: "Message actions" });
  await longPress(message.getByText(text), sheet);
  return sheet;
}

test("a long press opens a message's actions in a sheet that fits the phone, with nothing showing on the message", async ({ page, room, participant, screenIsFine }) => {
  test.skip(!hasPhoneLayout(page), "Wider touch screens have Message options");
  const ada = await participant("Ada");
  await ada.say("Hold this message to react to it");
  await openRoom(page, room);

  const message = page.getByRole("article").filter({ hasText: "Hold this message" });
  // Message options is there for screen readers and keyboards, but not to see.
  expect(await message.getByRole("button", { name: "Message options" }).evaluate((button) => button.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  await screenIsFine();

  const sheet = await openActions(page, message, "Hold this message");
  await expect(sheet.getByRole("button", { name: "Reply in thread" })).toBeVisible();
  await screenIsFine();

  // Add reaction opens a sheet of reactions in its place.
  await sheet.getByRole("button", { name: "Add reaction" }).tap();
  const picker = page.getByRole("dialog", { name: "Add reaction" });
  await expect(picker).toBeVisible();
  await expect(sheet).toBeHidden();
  await screenIsFine();
  await picker.getByRole("group", { name: "All reactions" }).getByRole("button", { name: "Fire" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button", { name: "🔥" })).toBeVisible();
  await expect(picker).toBeHidden();

  await openActions(page, message, "Hold this message");
  await sheet.getByRole("button", { name: "Thumbs up" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button", { name: "👍" })).toBeVisible();
  await expect(sheet).toBeHidden();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });
});

test("message actions open with a tap on Message options and fit a wider touch screen", async ({ page, room, participant, screenIsFine }) => {
  test.skip(hasPhoneLayout(page), "Phones open them with a long press");
  const ada = await participant("Ada");
  await ada.say("Tap the options button to react to this");
  await openRoom(page, room);

  // Touch screens can't hover, so each message has an options button instead. The actions open beside
  // it, over the timeline.
  const message = page.getByRole("article").filter({ hasText: "Tap the options button" });
  const options = message.getByRole("button", { name: "Message options" });
  const actions = page.getByRole("group", { name: "Message actions" });
  await options.tap();
  await expect(actions).toBeVisible();
  await screenIsFine();

  await actions.getByRole("button", { name: "More reactions" }).tap();
  const tray = page.getByRole("group", { name: "More reactions" });
  await expect(tray).toBeVisible();
  await screenIsFine();
  await tray.getByRole("button", { name: "Fire" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button", { name: "🔥" })).toBeVisible();
  // A reaction closes the bar, and focus goes back to Message options.
  await expect(actions).toBeHidden();
  await expect(options).toBeFocused();

  await options.tap();
  await actions.getByRole("button", { name: "Thumbs up" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button", { name: "👍" })).toBeVisible();
  await expect(actions).toBeHidden();
  await expect(options).toBeFocused();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });
});

test("Add reaction, New boost's form and Delete this boost fit the phone", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  await ada.say("React to this in your own words");
  await openRoom(page, room);

  const message = page.getByRole("article").filter({ hasText: "React to this" });
  const reactions = message.getByRole("list", { name: "Reactions" });
  await (await openActions(page, message, "React to this")).getByRole("button", { name: "Thumbs up" }).tap();
  // A pill after the reactions, which opens a picker of reactions alone: a sheet on a phone, and beside it wider.
  const add = reactions.getByRole("button", { name: "Add reaction" });
  await screenIsFine({ denseTargets: [REACTION_PILLS] });
  const pill = (await reactions.getByRole("listitem").first().boundingBox())!;
  expect(Math.abs((await add.boundingBox())!.height - pill.height)).toBeLessThanOrEqual(1);
  await add.tap();
  const picker = page.getByRole("dialog", { name: "Add reaction" });
  await expect(picker).toBeVisible();
  await expect(page.getByRole("group", { name: "Message actions" })).toBeHidden();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });

  // The form fits, and leaves the message its width.
  await picker.getByRole("button", { name: "New boost" }).tap();
  const field = message.getByRole("textbox", { name: "Custom reaction" });
  await expect(field).toBeFocused();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });
  expect((await message.locator(".message-content").boundingBox())!.width).toBeGreaterThan(100);
  await field.fill("Lovely!");
  await message.getByRole("button", { name: "Add reaction" }).tap();
  const mine = reactions.getByRole("button", { name: "Lovely!" });
  await expect(mine).toBeVisible();

  await mine.tap();
  const remove = reactions.getByRole("button", { name: "Delete this boost" });
  await expect(remove).toBeFocused();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });
  await remove.tap();
  await expect(mine).toHaveCount(0);
});

test("tapping Message options again closes the actions", async ({ page, room, participant }) => {
  test.skip(hasPhoneLayout(page), "Phones open them in a sheet with a long press");
  const ada = await participant("Ada");
  await ada.say("Open and close my actions");
  await openRoom(page, room);

  const options = page.getByRole("article").filter({ hasText: "Open and close my actions" }).getByRole("button", { name: "Message options" });
  const actions = page.getByRole("group", { name: "Message actions" });
  await options.tap();
  await expect(actions).toBeVisible();
  await options.tap();
  await expect(options).toHaveAttribute("aria-expanded", "false");
  await expect(actions).toBeHidden();
});

test("tapping anywhere else closes the actions, so only one message has them open", async ({ page, room, participant }) => {
  test.skip(hasPhoneLayout(page), "Phones open them in a sheet with a long press");
  const ada = await participant("Ada");
  // The first message's actions open over the next few, three rows of them on the narrowest phone, so the
  // last one's button is clear of them.
  for (const text of ["The first message", "The second", "The third", "The fourth", "The fifth", "The last message"]) await ada.say(text);
  await openRoom(page, room);
  // In landscape the first message's button is under the header, so tapping it scrolls the timeline
  // up, and the composer's editor mounting then would resize the timeline, which keeps to its end
  // while it's that near, moving the button out from under the tap.
  await expect(editorField(page, "Write a message")).toBeVisible();

  const first = page.getByRole("article").filter({ hasText: "The first message" });
  const last = page.getByRole("article").filter({ hasText: "The last message" });
  const actions = page.getByRole("group", { name: "Message actions" });
  await first.getByRole("button", { name: "Message options" }).tap();
  await expect(actions).toHaveCount(1);
  await last.getByRole("button", { name: "Message options" }).tap();
  await expect(last.getByRole("button", { name: "Message options" })).toHaveAttribute("aria-expanded", "true");
  await expect(first.getByRole("button", { name: "Message options" })).toHaveAttribute("aria-expanded", "false");
  await expect(actions).toHaveCount(1);

  await first.getByText("The first message").tap();
  await expect(last.getByRole("button", { name: "Message options" })).toHaveAttribute("aria-expanded", "false");
  await expect(actions).toHaveCount(0);
});

test("tapping outside a message's sheet closes it", async ({ page, room, participant }) => {
  test.skip(!hasPhoneLayout(page), "Wider touch screens have Message options");
  const ada = await participant("Ada");
  await ada.say("Open and close my sheet");
  await openRoom(page, room);

  const sheet = await openActions(page, page.getByRole("article").filter({ hasText: "Open and close my sheet" }), "Open and close my sheet");
  // Outside the sheet, over the timeline: above it, or beside it on a phone on its side, where it's as
  // tall as the screen.
  await page.touchscreen.tap(8, 8);
  await expect(sheet).toBeHidden();
});

test("your own messages can be edited on a phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const composer = editorField(page, "Write a message");
  await composer.tap();
  await page.keyboard.type("A message to edit");
  await page.getByRole("button", { name: "Send Message" }).tap();

  const message = page.getByRole("article").filter({ hasText: "A message to edit" });
  await expect(message).not.toHaveAttribute("aria-busy");
  // Without a mouse, Edit is on the bar that Message options opens.
  await message.getByRole("button", { name: "Message options" }).tap();
  await message.getByRole("button", { name: "Edit", exact: true }).tap();
  const field = editorField(message, "Edit message");
  await expect(field).toBeFocused();
  await screenIsFine();

  // On a phone, Enter starts a new line, as it does in the composer, so Save and Cancel are buttons under the editor.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("with a second line");
  await message.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(message.getByText("(edited)")).toBeVisible();
  await expect(message.locator(".message-content")).toContainText("A message to edit\nwith a second line", { useInnerText: true });

  // The tab bar comes back as the keyboard goes, moving the room under a finger that's already down.
  if (hasPhoneLayout(page)) await expect(tabBar(page)).toBeVisible();
  await message.getByRole("button", { name: "Message options" }).tap();
  await message.getByRole("button", { name: "Edit", exact: true }).tap();
  await message.getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(field).toBeHidden();
});

test("deleting your own message from its sheet asks first, in a dialog that fits the phone", async ({ page, room, screenIsFine }) => {
  test.skip(!hasPhoneLayout(page), "Wider touch screens delete from the editor");
  await openRoom(page, room);
  await editorField(page, "Write a message").tap();
  await page.keyboard.type("A message to delete");
  await page.getByRole("button", { name: "Send Message" }).tap();
  const message = page.getByRole("article").filter({ hasText: "A message to delete" });
  await expect(message).not.toHaveAttribute("aria-busy");

  const sheet = await openActions(page, message, "A message to delete");
  await sheet.getByRole("button", { name: "Delete message" }).tap();
  const question = page.getByRole("alertdialog", { name: "Delete message?" });
  await expect(question).toBeVisible();
  await screenIsFine();
  await question.getByRole("button", { name: "Cancel" }).tap();
  await expect(question).toBeHidden();
  await expect(message).toBeVisible();

  await (await openActions(page, message, "A message to delete")).getByRole("button", { name: "Delete message" }).tap();
  await question.getByRole("button", { name: "Delete", exact: true }).tap();
  await expect(message).toHaveCount(0);
});

test("Jump to newest message appears as one comes while you're scrolled back, and fits", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  for (let i = 1; i <= 30; i++) await ada.say(`Message ${i}`);
  await openRoom(page, room);
  await expect(page.getByText("Message 30", { exact: true })).toBeVisible();

  await page.getByRole("log").evaluate((log) => log.scrollTo({ top: 0 }));
  // The timeline hears of a scroll by script with the next frame, as an IntersectionObserver does, so a
  // message that came sooner would find the reader still at the end, and take them back there.
  await expect(page.getByText("Message 30", { exact: true })).not.toBeInViewport();
  await ada.say("Message 31");
  const jump = page.getByRole("button", { name: "Jump to newest message" });
  await expect(jump).toBeVisible();
  await screenIsFine();

  await jump.tap();
  await expect(page.getByText("Message 31", { exact: true })).toBeInViewport();
});

test("the timeline stays on the newest message when it grows and then shrinks", async ({ page, room, participant }) => {
  const ada = await participant("Ada");
  for (let i = 1; i <= 30; i++) await ada.say(`Message ${i}`);
  await openRoom(page, room);
  const log = page.getByRole("log");
  const distanceFromEnd = () => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(await distanceFromEnd()).toBeLessThanOrEqual(1);

  // The timeline grows, as when an inset goes away or the keyboard closes, so its scroll position
  // is clamped and a scroll event queued. Before the next frame delivers it, the timeline shrinks, as
  // when the keyboard opens. That late scroll isn't the reader scrolling away from the newest message.
  await log.evaluate(async (el) => {
    const timeline = el.parentElement!;
    timeline.style.flex = `0 0 ${timeline.clientHeight + 120}px`;
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    timeline.style.flex = "0 0 20px";
  });
  await expect.poll(distanceFromEnd).toBeLessThanOrEqual(1);
});

test("a notice fits the phone and can be dismissed", async ({ page, room, screenIsFine }) => {
  // Pass the real socket through, and add an error from the room on top.
  let socket: { send: (message: string) => void } | undefined;
  await page.routeWebSocket(/\/api\/rooms\/.+\/socket/, (ws) => {
    ws.connectToServer();
    socket = ws;
  });
  await openRoom(page, room);
  socket!.send(JSON.stringify({ type: "error", message: "Something went wrong while sending your last message. Try again." }));

  const notice = page.getByRole("alert");
  await expect(notice).toBeVisible();
  await screenIsFine();
  await notice.getByRole("button", { name: "Dismiss" }).tap();
  await expect(notice).toBeHidden();
});
