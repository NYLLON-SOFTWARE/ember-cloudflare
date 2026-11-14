import type { Locator } from "@playwright/test";
import { editorField, openRoom, signInAs } from "../../fixtures";
import { expect, hasPhoneLayout, REACTION_PILLS, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("a thread opens from its message's replies over the room, fits the phone, and goes back to the room", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  const parent = await ada.say("Who's bringing snacks?");
  await ada.reply(parent.id, "I'll bring fruit");
  await openRoom(page, room);

  const replies = page.getByRole("article").filter({ hasText: "Who's bringing snacks?" }).getByRole("link", { name: /^1 reply\b/ });
  await expect(replies).toBeVisible();
  await screenIsFine({ denseTargets: [REACTION_PILLS] });

  await replies.tap();
  const thread = page.getByRole("complementary", { name: "Thread" });
  await expect(thread.getByRole("article").filter({ hasText: "I'll bring fruit" })).toBeVisible();
  await expect(editorField(thread, "Write a reply")).toBeVisible();
  await screenIsFine();

  // Phones go back to the room from the header, where wider screens close the thread.
  await thread.getByRole("link", { name: hasPhoneLayout(page) ? `Back to ${room.name}` : "Close thread" }).tap();
  await expect(thread).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/rooms/${room.id}$`));
});

test("Reply in thread and Quote fit the phone in a message's actions", async ({ page, room, participant, screenIsFine }) => {
  await (await participant("Ada")).say("Reply to me in a thread");
  await openRoom(page, room);

  // A phone opens them in a sheet with a long press, which lists them by name; a wider touch screen opens
  // a bar beside Message options.
  const message = page.getByRole("article").filter({ hasText: "Reply to me in a thread" });
  const phone = hasPhoneLayout(page);
  const actions = phone ? page.getByRole("dialog", { name: "Message actions" }) : page.getByRole("group", { name: "Message actions" });
  if (phone) await longPress(message.getByText("Reply to me in a thread"), actions);
  else await message.getByRole("button", { name: "Message options" }).tap();
  await expect(actions.getByRole("button", { name: "Quote" })).toBeVisible();
  await screenIsFine();

  await actions.getByRole(phone ? "button" : "link", { name: "Reply in thread" }).tap();
  const thread = page.getByRole("complementary", { name: "Thread" });
  await expect(thread.getByRole("article").filter({ hasText: "Reply to me in a thread" })).toBeVisible();
  // On a phone the reply box is Slack's pill until it's tapped, which then offers to send to the room too.
  if (phone) await editorField(thread, "Write a reply").tap();
  await expect(thread.getByRole("checkbox", { name: `Also send to #${room.name}` })).toBeVisible();
  await screenIsFine();
});

/** Rests a finger on `target` until `opens` shows, as a long press does, then lifts it. Playwright's touchscreen only taps. */
async function longPress(target: Locator, opens: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const cdp = await target.page().context().newCDPSession(target.page());
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await expect(opens).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
