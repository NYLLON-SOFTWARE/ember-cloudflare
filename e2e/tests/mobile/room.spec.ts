import { REACTIONS, type RoomList } from "@ember/protocol";
import { isolateRoom, openRoom, signInAs } from "../../fixtures";
import { expect, hasDrawerLayout, REACTION_CHIPS, test } from "./fixtures";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test("an empty room fits the phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  await expect(page.getByRole("heading", { name: `Welcome to #${room.name}` })).toBeVisible();
  await screenIsFine();
});

test("the page for someone in no rooms fits the phone", async ({ page, screenIsFine }) => {
  await page.route("**/api/rooms", (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { rooms: [], invitation: null } satisfies RoomList }) : route.fallback(),
  );
  await page.goto("/");
  await expect(page).toHaveTitle("No rooms yet");
  await expect(page.getByRole("main").locator("img")).toBeVisible();
  await screenIsFine();
});

test("the welcome card fits the phone", async ({ page, room, screenIsFine }) => {
  await isolateRoom(page, room, { joinCode: "aB3d-Ef5h-iJ7k" });
  await openRoom(page, room);
  await expect(page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
  await screenIsFine();
});

test("the join link's QR code fits the phone", async ({ page, room, screenIsFine }) => {
  await isolateRoom(page, room, { joinCode: "aB3d-Ef5h-iJ7k" });
  await openRoom(page, room);
  await page.getByRole("link", { name: "Show join link QR code" }).click();
  const viewer = page.getByRole("dialog", { name: "Image Viewer (Press escape to close)" });
  await expect(viewer.locator("img[src^='/qr_code/']")).toBeVisible();
  await screenIsFine();
});

test("a busy room fits the phone", async ({ page, room, participant, screenIsFine }) => {
  const ada = await participant("Ada");
  const longName = await participant("Bartholomew Featherstonehaugh-Montgomery III");
  for (const name of ["Grace", "Linus", "Margaret", "Tim"]) await participant(name);

  await ada.say(`Here's the link: https://example.com/${"really-long-path-segment-".repeat(8)}end`);
  const busy = await longName.say("A message from someone whose name takes most of a phone's width, to check that the header wraps rather than overflows.");
  for (const [emoji] of REACTIONS) await ada.boost(busy.id, emoji);
  await ada.say(`${"Supercalifragilisticexpialidocious".repeat(4)} — one unbroken word`);
  await ada.say("Line one\nLine two\n\nLine four after a blank line");
  await ada.say("🔥🔥🔥");

  await openRoom(page, room);
  await expect(page.getByText("🔥🔥🔥")).toBeVisible();
  // Four faces, then a count for everyone else.
  await expect(page.getByText("+3")).toBeVisible();
  await screenIsFine({ denseTargets: [REACTION_CHIPS] });
});

test("long room names are truncated, not overflowing", async ({ page, room, screenIsFine }) => {
  const name = "quarterly-planning-and-retrospective-for-the-platform-team";
  await isolateRoom(page, { ...room, name });
  await openRoom(page, { ...room, name });
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await screenIsFine();

  if (hasDrawerLayout(page)) {
    await page.getByRole("button", { name: "Open conversations" }).tap();
    await expect(page.getByRole("dialog")).toBeVisible();
  }
  await expect(page.getByRole("link", { name })).toBeVisible();
  await screenIsFine();
});

test("the rail's menus fit the phone", async ({ page, room, screenIsFine }) => {
  await openRoom(page, room);
  const rail = page.getByRole("navigation", { name: "Workspace" });
  if (hasDrawerLayout(page)) await page.getByRole("button", { name: "Open conversations" }).tap();

  // Where the rail scrolls, as on a phone in landscape, start with the button at the bottom of the
  // screen, where its menu is most likely to open under the home indicator.
  const appearance = rail.getByRole("button", { name: "Appearance: System" });
  await appearance.evaluate((button) => button.scrollIntoView({ block: "end" }));
  await appearance.tap();
  const menu = page.getByRole("dialog", { name: "Appearance" });
  await expect(menu).toBeVisible();
  await screenIsFine();
  await menu.getByText("Dark", { exact: true }).tap();
  await expect(page.locator("html")).toHaveClass(/dark/);

  await rail.getByRole("button", { name: "Your profile" }).tap();
  await expect(page.getByRole("menuitem", { name: "Log out" })).toBeVisible();
  await screenIsFine();
});
