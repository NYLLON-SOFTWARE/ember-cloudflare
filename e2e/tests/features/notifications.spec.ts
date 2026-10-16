import { feature } from "@ember/parity";
import type { Page } from "@playwright/test";
import { expect, startDirect, test, unique } from "./fixtures";

const MENTIONS = "Notifying about @ mentions";
const EVERYTHING = "Notifying about all messages";
const NOTHING = "Notifications are off";
const INVISIBLE = "Notifications are off and room invisible in sidebar";

/** The bell in the header of the room or DM shown, named for your level there. */
const headerBell = (page: Page) => page.getByRole("navigation", { name: "Page" }).getByRole("checkbox");

/** The sidebar's rows for rooms, top to bottom. */
const roomRows = (page: Page) => page.getByRole("region", { name: "Rooms" }).getByRole("link");

/** The rail's Activity, whose description counts the conversations marked unread. */
const activity = (page: Page) => page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Activity" });

/** Opens your profile from the rail, where your rooms and DMs are listed with their bells. */
async function openYourProfile(page: Page) {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Your profile" }).click();
  await expect(page).toHaveURL(/\/users\/me\/profile$/);
  return page.getByRole("list", { name: "Conversation notifications" });
}

test.describe(feature("notifications.levels"), () => {
  test("goes round a room's levels from its header, which every tab of yours shows, and the server keeps", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace");
    const secondTab = await grace.page.context().newPage();
    await secondTab.goto(`/rooms/${rooms.general.id}`);
    const bell = headerBell(grace.page);
    await expect(bell).toHaveAccessibleName(MENTIONS);
    await expect(bell).toBeChecked();

    for (const level of [EVERYTHING, NOTHING]) {
      await bell.click();
      for (const page of [grace.page, secondTab]) await expect(headerBell(page)).toHaveAccessibleName(level);
      await expect(bell).toBeFocused();
    }
    // Ada's level is her own.
    await expect(headerBell(ada.page)).toHaveAccessibleName(MENTIONS);

    await grace.page.reload();
    await expect(headerBell(grace.page)).toHaveAccessibleName(NOTHING);
  });

  test("goes between all messages and off in a DM", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const roomId = await startDirect(request, ada, [grace]);
    await grace.page.goto(`/rooms/${roomId}`);
    await grace.connected();
    const bell = headerBell(grace.page);
    await expect(bell).toHaveAccessibleName(EVERYTHING);

    await bell.click();
    await expect(bell).toHaveAccessibleName(NOTHING);
    await bell.click();
    await expect(bell).toHaveAccessibleName(EVERYTHING);
  });
});

test.describe(feature("notifications.hide-room"), () => {
  test("hides the room shown from every tab's sidebar, keeping it open at its address, until it's shown again", async ({ members, rooms }) => {
    const grace = await members.signIn("Grace");
    const secondTab = await grace.page.context().newPage();
    await secondTab.goto(`/rooms/${rooms.random.id}`);
    await expect(roomRows(secondTab)).toHaveText(["#general", "#random"]);
    const bell = headerBell(grace.page);

    for (const level of [EVERYTHING, NOTHING, INVISIBLE]) {
      await bell.click();
      await expect(bell).toHaveAccessibleName(level);
    }
    for (const page of [grace.page, secondTab]) await expect(roomRows(page)).toHaveText(["#random"]);
    await expect(grace.page.getByRole("heading", { level: 1 })).toHaveText("general");
    await grace.send("Still here");
    await expect(grace.message("Still here")).toBeVisible();
    await expect(grace.message("Still here")).not.toHaveAttribute("aria-busy");

    // The server keeps it hidden, and it still opens at its address.
    for (const page of [grace.page, secondTab]) await page.reload();
    await grace.connected();
    await expect(grace.page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(bell).toHaveAccessibleName(INVISIBLE);
    for (const page of [grace.page, secondTab]) await expect(roomRows(page)).toHaveText(["#random"]);

    await bell.click();
    await expect(bell).toHaveAccessibleName(MENTIONS);
    for (const page of [grace.page, secondTab]) await expect(roomRows(page)).toHaveText(["#general", "#random"]);
  });
});

test.describe(feature("notifications.profile-list"), () => {
  test("lists your rooms by name, then your DMs, each with its bell, and dims a room you hide there, leaving it out of Activity", async ({ members, request, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"), { path: `/rooms/${rooms.random.id}` });
    await startDirect(request, ada, [grace]);
    await ada.send("Lunch?");
    await expect(activity(grace.page)).toHaveAccessibleDescription("1 unread");

    const list = await openYourProfile(grace.page);
    await expect(list.getByRole("link")).toHaveText(["general", "random", ada.name]);
    // Each bell's name is its label's text.
    await expect(list.getByRole("checkbox")).toHaveText([MENTIONS, MENTIONS, EVERYTHING]);
    // A rule between the rooms and the DMs.
    expect(await list.evaluate((menu) => [...menu.children].map((child) => child.tagName))).toEqual(["LI", "LI", "HR", "LI"]);
    await expect(list.getByRole("link", { name: "general", exact: true })).toHaveAttribute("href", `/rooms/${rooms.general.id}`);

    const general = list.getByRole("listitem").filter({ has: grace.page.getByRole("link", { name: "general", exact: true }) });
    const bell = general.getByRole("checkbox");
    for (const level of [EVERYTHING, NOTHING, INVISIBLE]) {
      await bell.click();
      await expect(bell).toHaveAccessibleName(level);
    }
    await expect(general).toHaveCSS("opacity", "0.5");
    await expect(roomRows(grace.page)).toHaveText(["#random"]);
    await expect(activity(grace.page)).not.toHaveAttribute("aria-description");

    // Shown again, it's still marked unread from before it was hidden.
    await bell.click();
    await expect(bell).toHaveAccessibleName(MENTIONS);
    await expect(general).toHaveCSS("opacity", "1");
    await expect(roomRows(grace.page)).toHaveText(["#general", "#random"]);
    await expect(activity(grace.page)).toHaveAccessibleDescription("1 unread");
  });
});
