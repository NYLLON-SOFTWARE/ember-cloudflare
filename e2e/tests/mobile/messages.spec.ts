import { openRoom, signInAs } from "../../fixtures";
import { expect, REACTION_CHIPS, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("message actions open with a tap and fit the phone", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  await ada.say("Tap the options button to react to this");
  await openRoom(page, room);

  // Phones can't hover, so each message has an options button instead.
  const message = page.getByRole("article").filter({ hasText: "Tap the options button" });
  await message.getByRole("button", { name: "Message options" }).tap();
  const actions = message.getByRole("group", { name: "Message actions" });
  await expect(actions).toBeVisible();
  await screenIsFine();

  await actions.getByRole("button", { name: "More reactions" }).tap();
  await expect(page.getByRole("menu")).toBeVisible();
  await screenIsFine();
  await page.getByRole("menuitem", { name: "Fire" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button", { name: /🔥/ })).toBeVisible();

  await message.getByRole("button", { name: "Message options" }).tap();
  await actions.getByRole("button", { name: "Thumbs up" }).tap();
  await expect(message.getByRole("list", { name: "Reactions" }).getByRole("button")).toHaveCount(2);
  await screenIsFine({ denseTargets: [REACTION_CHIPS] });
});

test("your own messages can be edited on a phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const composer = page.getByRole("textbox", { name: `Message #${room.name}` });
  await composer.tap();
  await page.keyboard.type("A message to edit");
  await page.getByRole("button", { name: "Send" }).tap();

  const message = page.getByRole("article").filter({ hasText: "A message to edit" });
  await expect(message).not.toHaveAttribute("aria-busy");
  await message.getByRole("button", { name: "Message options" }).tap();
  await message.getByRole("button", { name: "Edit" }).tap();
  const field = message.getByRole("textbox", { name: "Edit message" });
  await expect(field).toBeFocused();
  await screenIsFine();

  // Enter starts a new line here too, so saving and cancelling need buttons.
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("with a second line");
  await message.getByRole("button", { name: "Save" }).tap();
  await expect(message.getByText("(edited)")).toBeVisible();
  await expect(message).toContainText("A message to edit\nwith a second line");

  await message.getByRole("button", { name: "Message options" }).tap();
  await message.getByRole("button", { name: "Edit" }).tap();
  await message.getByRole("button", { name: "Cancel" }).tap();
  await expect(field).toBeHidden();
});

test("return to latest appears after scrolling back, and fits", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  for (let i = 1; i <= 30; i++) await ada.say(`Message ${i}`);
  await openRoom(page, room);
  await expect(page.getByText("Message 30", { exact: true })).toBeVisible();

  await page.getByRole("log").evaluate((log) => log.scrollTo({ top: 0 }));
  const latest = page.getByRole("button", { name: "Return to latest messages" });
  await expect(latest).toBeVisible();
  await screenIsFine();

  await latest.tap();
  await expect(page.getByText("Message 30", { exact: true })).toBeInViewport();
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
