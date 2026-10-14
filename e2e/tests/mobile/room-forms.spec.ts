import { signInAs } from "../../fixtures";
import { expect, test } from "./fixtures";

/**
 * Switches keep Campfire's size, 42 by 24.5px at the 14px ember-rust sets them to on phones
 * (zz-ember.css), which WCAG 2.5.8's 24px floor allows.
 */
const SWITCHES = "[role=switch]";

// Asking for the test's room makes it the only one in the sidebar, which wider phones show beside the page.
test.beforeEach(async ({ page, session, room: _ }) => {
  await signInAs(page, session);
});

test("workspace settings fit the phone", async ({ page, screenIsFine }) => {
  await page.goto("/account/edit");
  await expect(page.getByRole("link", { name: "New room" })).toBeVisible();
  await screenIsFine();
});

test("the private New room form fits the phone", async ({ page, screenIsFine }) => {
  await page.goto("/rooms/closeds/new");
  await expect(page.getByRole("switch", { name: "Give everyone access to this room" })).toBeVisible();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("a room's settings fit the phone", async ({ page, room, screenIsFine }) => {
  await page.goto(`/rooms/opens/${room.id}/edit`);
  await expect(page.getByRole("textbox", { name: "Room name" })).toHaveValue(room.name);
  await screenIsFine();
});
