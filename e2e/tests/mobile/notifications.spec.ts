import type { Page } from "@playwright/test";
import type { Sidebar, SidebarRoom } from "@ember/protocol";
import { allowNotifications, isolateRoom, openRoom, signInAs } from "../../fixtures";
import { expect, hasPhoneLayout, test } from "./fixtures";

/** A room's details on a phone, which the top bar's pill opens. */
async function roomDetails(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Page" }).getByRole("button", { name: new RegExp(`^${name}`) }).tap();
  return page.getByRole("dialog", { name });
}

const LONG_NAME = "quarterly-planning-and-retrospective-for-the-platform-team";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test.describe("Notification levels", () => {
  test("the room's bell fits the phone beside a long room name, and a tap moves it on, confirming the level under it", async ({ page, room, screenIsFine }) => {
    test.skip(hasPhoneLayout(page), "A phone picks the level in the room's details");
    await allowNotifications(page.context());
    const named = { ...room, name: LONG_NAME };
    await isolateRoom(page, named);
    await openRoom(page, named);
    const header = page.getByRole("navigation", { name: "Page" });
    const bell = header.getByRole("checkbox");
    await expect(bell).toHaveAccessibleName("Notifying about @ mentions");
    await screenIsFine();

    await bell.tap();
    await expect(bell).toHaveAccessibleName("Notifying about all messages");
    // With the level it saved confirmed under it, on the screen.
    const tooltip = header.locator("[data-notification-tooltip]");
    await expect(tooltip).toHaveText("Notifying about all messages");
    await expect(tooltip).toBeVisible();
    await screenIsFine();
  });

  test("a phone picks the room's level from its details, a long name and all, even where it can't have notifications", async ({ page, room, screenIsFine }) => {
    test.skip(!hasPhoneLayout(page), "Wider screens have the bell in the top bar");
    // As in Safari on an iPhone, which only has push once Ember is on the Home Screen: the level is the server's all the same.
    await page.addInitScript(() => Reflect.deleteProperty(window, "PushManager"));
    const named = { ...room, name: LONG_NAME };
    await isolateRoom(page, named);
    await openRoom(page, named);
    const details = await roomDetails(page, LONG_NAME);
    const notifications = details.getByRole("button", { name: "Notifications" });
    await expect(notifications).toHaveAccessibleDescription("@ mentions");
    // Nothing to turn on where the phone can't have them.
    await expect(details.getByRole("button", { name: "Enable notifications" })).toHaveCount(0);
    await notifications.tap();

    const levels = page.getByRole("dialog", { name: "Notifications" }).getByRole("radiogroup", { name: "Notifications" });
    await expect(levels.getByRole("radio")).toHaveText(["All messages", "@ mentions", "Off", "Off and hidden"]);
    await expect(levels.getByRole("radio", { name: "@ mentions" })).toBeChecked();
    await screenIsFine();
    await levels.getByRole("radio", { name: "All messages" }).tap();
    await expect(levels).toBeHidden();
    await expect((await roomDetails(page, LONG_NAME)).getByRole("button", { name: "Notifications" })).toHaveAccessibleDescription("All messages");
  });
});

test.describe("Turn on notifications", () => {
  test("Enable notifications fits the phone with a long room name, and so does its setup dialog, with its help's one section open", async ({ page, room, screenIsFine }) => {
    // As in Safari on an iPhone, which only has push once Ember is on the Home Screen; a phone's details
    // offer nothing to turn on there, so a wider screen's bell says why.
    test.skip(hasPhoneLayout(page), "A phone that can't have notifications offers none to turn on");
    await page.addInitScript(() => Reflect.deleteProperty(window, "PushManager"));
    const named = { ...room, name: LONG_NAME };
    await isolateRoom(page, named);
    await openRoom(page, named);
    await screenIsFine();

    await page.getByRole("navigation", { name: "Page" }).getByRole("button", { name: "Enable notifications", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "Notification setup" });
    await expect(dialog.getByRole("heading", { level: 1 })).toHaveText("Notifications aren’t available here");
    await expect(dialog.locator("details[open]")).toHaveCount(1);
    await screenIsFine();
  });

  test("a phone that can have notifications turns them on from the room's details", async ({ page, room }) => {
    test.skip(!hasPhoneLayout(page), "Wider screens have the bell in the top bar");
    await openRoom(page, room);
    const details = await roomDetails(page, room.name);
    await expect(details.getByRole("button", { name: "Enable notifications", exact: true })).toBeVisible();
  });
});

test.describe("Levels on your profile", () => {
  test("your conversation notifications fit the phone, with long names and a room you've hidden", async ({ page, room, session, screenIsFine }) => {
    const rooms: SidebarRoom[] = [
      { ...room, kind: "open", icon: null, unread: false, involvement: "mentions" },
      { id: `${room.id}-hidden`, name: LONG_NAME, kind: "open", icon: null, unread: false, involvement: "invisible" },
      {
        id: `${room.id}-direct`,
        kind: "direct",
        members: [session.user, { id: `${session.user.id}-grace`, name: "Grace Brewster Murray Hopper, Rear Admiral" }],
        activeAt: new Date().toISOString(),
        unread: false,
        involvement: "everything",
      },
    ];
    await page.route("**/api/sidebar", (route) =>
      route.fulfill({ json: { rooms, favorites: { rooms: [], version: 0 }, sharedOrder: [], invitation: null, suggestions: [], huddles: {} } satisfies Sidebar }),
    );
    await page.goto("/users/me/profile");
    const list = page.getByRole("list", { name: "Conversation notifications" });
    await expect(list.getByRole("checkbox")).toHaveText(["Notifying about @ mentions", "Notifications are off and room invisible in sidebar", "Notifying about all messages"]);
    await list.scrollIntoViewIfNeeded();
    await screenIsFine();
  });
});
