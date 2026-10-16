import { feature } from "@ember/parity";
import type { Sidebar, SidebarRoom } from "@ember/protocol";
import { isolateRoom, openRoom, signInAs } from "../../fixtures";
import { expect, test } from "./fixtures";

const LONG_NAME = "quarterly-planning-and-retrospective-for-the-platform-team";

test.beforeEach(async ({ page, session }) => {
  await signInAs(page, session);
});

test.describe(feature("notifications.levels"), () => {
  test("the header's bell fits the phone beside a long room name, and a tap moves it on", async ({ page, room, screenIsFine }) => {
    const named = { ...room, name: LONG_NAME };
    await isolateRoom(page, named);
    await openRoom(page, named);
    const bell = page.getByRole("navigation", { name: "Page" }).getByRole("checkbox");
    await expect(bell).toHaveAccessibleName("Notifying about @ mentions");
    await screenIsFine();

    await bell.tap();
    await expect(bell).toHaveAccessibleName("Notifying about all messages");
    await screenIsFine();
  });
});

test.describe(feature("notifications.profile-list"), () => {
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
      route.fulfill({ json: { rooms, favorites: { rooms: [], version: 0 }, sharedOrder: [], invitation: null, suggestions: [] } satisfies Sidebar }),
    );
    await page.goto("/users/me/profile");
    const list = page.getByRole("list", { name: "Conversation notifications" });
    await expect(list.getByRole("checkbox")).toHaveText(["Notifying about @ mentions", "Notifications are off and room invisible in sidebar", "Notifying about all messages"]);
    await list.scrollIntoViewIfNeeded();
    await screenIsFine();
  });
});
