import { feature } from "@ember/parity";
import type { Sidebar } from "@ember/protocol";
import type { Page, WebSocketRoute } from "@playwright/test";
import { cookieHeader, invitation, signInAs, WORKSPACE_SOCKET } from "../../fixtures";
import { expect, test } from "./fixtures";

test.describe(feature("sidebar.rooms"), () => {
  test("lists the rooms the server says you're in", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { serverRooms: true });
    const sidebar = ada.page.getByRole("region", { name: "Rooms" });
    // Every other test's open rooms are listed too, so look for this test's by address.
    for (const room of Object.values(rooms)) {
      await expect(sidebar.locator(`a[href="/rooms/${room.id}"]`)).toHaveText(`#${room.name}`);
    }
  });

  test("marks the open room and switches between them", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const links = ada.page.getByRole("region", { name: "Rooms" }).getByRole("link");
    await expect(links).toHaveText(["#general", "#random"]);
    await expect(links.first()).toHaveAttribute("aria-current", "page");

    await links.filter({ hasText: "random" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.random.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
    await expect(links.filter({ hasText: "random" })).toHaveAttribute("aria-current", "page");

    await ada.page.goBack();
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
  });
});

test.describe(feature("sidebar.live-updates"), () => {
  test("loads the sidebar again when the tab's workspace connection comes back", async ({ members, request, rooms, session }) => {
    let connection: { page: WebSocketRoute; server: WebSocketRoute } | undefined;
    const ada = await members.signIn("Ada", {
      beforeOpen: (page) => page.routeWebSocket(WORKSPACE_SOCKET, (ws) => void (connection = { page: ws, server: ws.connectToServer() })),
    });
    const links = ada.page.getByRole("region", { name: "Rooms" }).getByRole("link");
    await expect(links).toHaveText(["#general", "#random"]);

    const renamed = await request.patch(`/api/rooms/${rooms.random.id}`, { data: { name: "watercooler" }, headers: { Cookie: cookieHeader(session) } });
    expect(renamed.status(), await renamed.text()).toBe(200);
    await expect.poll(() => connection).toBeDefined();
    await connection!.server.close();
    await connection!.page.close();
    await expect(links).toHaveText(["#general", "#watercooler"]);
  });
});

test.describe(feature("sidebar.unread"), () => {
  test("marks a room bold with a dot for members not in it, through a reload, until they open it in any tab", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace", { path: `/rooms/${rooms.random.id}` });
    const general = (page: Page) => page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: "general" });
    await expect(general(grace.page)).not.toHaveAccessibleDescription("Unread");

    await ada.send("Lunch?");
    await expect(general(grace.page)).toHaveAccessibleDescription("Unread");
    await expect(general(grace.page)).toHaveCSS("font-weight", "650");
    await expect(general(grace.page).locator("span").last()).toHaveCSS("width", "7px");

    // The server keeps the mark.
    await grace.page.reload();
    await expect(general(grace.page)).toHaveAccessibleDescription("Unread");

    const secondTab = await grace.page.context().newPage();
    await secondTab.goto(`/rooms/${rooms.general.id}`);
    await expect(general(grace.page)).not.toHaveAccessibleDescription("Unread");
    await expect(general(grace.page)).toHaveCSS("font-weight", "400");
  });
});

test.describe(feature("sidebar.activity-filter"), () => {
  test("counts the rooms marked unread, shows only them while it's on, and a room's link turns it off", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    const grace = await members.signIn("Grace", { path: `/rooms/${rooms.random.id}` });
    const activity = grace.page.getByRole("navigation", { name: "Workspace" }).getByRole("button", { name: "Activity" });
    const rows = grace.page.getByRole("region", { name: "Rooms" }).getByRole("link");
    const caughtUp = grace.page.getByText("You’re all caught up. No unread conversations.");
    await expect(activity).toHaveAttribute("title", "Show unread conversations");

    await activity.click();
    await expect(activity).toHaveAttribute("aria-pressed", "true");
    await expect(rows).toHaveCount(0);
    await expect(caughtUp).toBeVisible();
    // The rail marks no page while it's on.
    await expect(grace.page.getByRole("navigation", { name: "Workspace" }).locator("[aria-current]")).toHaveCount(0);

    await ada.send("Lunch?");
    await expect(activity).toHaveAccessibleDescription("1 unread");
    await expect(activity.getByText("1", { exact: true })).toHaveCSS("height", "17px");
    await expect(rows).toHaveText(["#general"]);
    await expect(caughtUp).toBeHidden();

    await rows.first().click();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(activity).toHaveAttribute("aria-pressed", "false");
    // The room shown counts as read, so the pill goes.
    await expect(activity).not.toHaveAttribute("aria-description");
    await expect(activity.getByText("1", { exact: true })).toBeHidden();
    await expect(rows).toHaveText(["#general", "#random"]);
  });
});

test.describe(feature("sidebar.favorites"), () => {
  test("stars a room from its header, which every tab of yours lists first with a star, until it's unstarred", async ({ members, rooms }) => {
    const grace = await members.signIn("Grace", { path: `/rooms/${rooms.random.id}` });
    const secondTab = await grace.page.context().newPage();
    await secondTab.goto(`/rooms/${rooms.general.id}`);
    const rows = (page: Page) => page.getByRole("region", { name: "Rooms" }).getByRole("link");
    const star = grace.page.getByRole("navigation", { name: "Page" }).getByRole("button", { name: "Favorite room" });
    await expect(rows(secondTab)).toHaveText(["#general", "#random"]);
    await expect(star).toHaveAttribute("title", "Add to favorites");
    await expect(star.locator("svg")).toHaveCSS("fill", "none");

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await expect(star).toHaveAttribute("title", "Remove from favorites");
    await expect(star.locator("svg")).not.toHaveCSS("fill", "none");
    await expect(star).toBeFocused();
    for (const page of [grace.page, secondTab]) {
      await expect(rows(page)).toHaveText(["#random★", "#general"]);
      await expect(rows(page).first()).toHaveAccessibleName("random Favorite");
    }

    // The server keeps it.
    await secondTab.reload();
    await expect(rows(secondTab)).toHaveText(["#random★", "#general"]);
    await expect(secondTab.getByRole("navigation", { name: "Page" }).getByRole("button", { name: "Favorite room" })).toHaveAttribute("aria-pressed", "false");

    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    for (const page of [grace.page, secondTab]) await expect(rows(page)).toHaveText(["#general", "#random"]);
  });

  test("says when a star can't be saved, under the star, and changes nothing", async ({ members, rooms }) => {
    const grace = await members.signIn("Grace", { path: `/rooms/${rooms.random.id}` });
    await grace.page.route("**/api/rooms/*/favorite", (route) => route.fulfill({ status: 503, json: { error: "Workspace unavailable" } }));
    const star = grace.page.getByRole("navigation", { name: "Page" }).getByRole("button", { name: "Favorite room" });

    await star.click();
    const note = grace.page.getByRole("status").filter({ hasText: "Couldn’t save your favorite. Please try again." });
    await expect(note).toBeVisible();
    await expect(note).toHaveCSS("width", "200px");
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await expect(grace.page.getByRole("region", { name: "Rooms" }).getByRole("link")).toHaveText(["#general", "#random"]);
  });
});

test.describe(feature("rooms.show"), () => {
  test("opens the room named in the address", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: `/rooms/${rooms.random.id}` });
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
  });

  test("goes home with an alert for an address naming a room that doesn't exist", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: "/rooms/nowhere" });
    await expect(ada.page.getByRole("alert")).toHaveText("Room not found or inaccessible");
    // Home, which is their oldest room, since this browser has shown them none yet.
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(ada.page).toHaveTitle("general");
  });
});

test.describe(feature("rooms.last-visited"), () => {
  test("goes home to the room you were in last, as Go Back from settings does", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: `/rooms/${rooms.random.id}` });
    await ada.page.goto("/");
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.random.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");

    await ada.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Workspace" }).click();
    await expect(ada.page).toHaveURL(/\/account\/edit$/);
    await ada.page.getByRole("link", { name: "Go Back" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.random.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
  });

  test("shows someone in no rooms a picture of an empty room, with their name for screen readers", async ({ page, session }) => {
    await signInAs(page, session);
    await page.route("**/api/sidebar", (route) => route.fulfill({ json: { rooms: [], favorites: { rooms: [], version: 0 }, invitation: null } satisfies Sidebar }));
    await page.goto("/");
    await expect(page).toHaveTitle("No rooms yet");
    const main = page.getByRole("main");
    await expect(main.locator("img")).toBeVisible();
    await expect(main).toHaveText(session.user.name);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe(feature("rooms.index"), () => {
  test("opens your newest room at /rooms", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: "/rooms" });
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.random.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
  });

  test("opens a room from the address for its kind, which Back then skips", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    await ada.page.goto(`/rooms/opens/${rooms.random.id}`);
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.random.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");

    await ada.page.goBack();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
  });

  test("reads /rooms/opens as a room's address, naming none", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: "/rooms/opens" });
    await expect(ada.page.getByRole("alert")).toHaveText("Room not found or inaccessible");
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
  });
});

test.describe(feature("rooms.open"), () => {
  test("lets everyone into every room, and keeps each room's messages to itself", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: `/rooms/${rooms.random.id}` });
    const grace = await members.signIn("Grace");
    await ada.send("Only in random");
    await expect(ada.message("Only in random")).toBeVisible();
    await expect(grace.message("Only in random")).toHaveCount(0);

    await grace.page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: /random/ }).click();
    await expect(grace.message("Only in random")).toBeVisible();
  });
});

test.describe(feature("rooms.invitation-card"), () => {
  test("welcomes people to the first room with the workspace's join link", async ({ baseURL, members, request, session }) => {
    const { roomId, joinCode } = await invitation(request, session);
    const ada = await members.signIn("Ada", { path: `/rooms/${roomId}`, serverRooms: true });
    const log = ada.page.getByRole("log", { name: "Messages in All Talk" });
    await expect(log.getByRole("heading", { level: 2, name: "Welcome to Ember" })).toBeVisible();
    await expect(log.getByText("To invite people to chat, share the join link below.")).toBeVisible();
    await expect(log.getByRole("textbox", { name: "Share to invite more people" })).toHaveValue(new URL(`/join/${joinCode}`, baseURL).href);
    // It takes the place of the welcome an empty room has.
    await expect(log.getByText("This is the very beginning of the room. Say hello!")).toHaveCount(0);
  });

  test("stays in the first room", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await expect(ada.page.getByRole("heading", { name: "Welcome to #general" })).toBeVisible();
    await expect(ada.page.getByRole("heading", { name: "Welcome to Ember" })).toHaveCount(0);
  });
});

test.describe(feature("accounts.join-link"), () => {
  test("copies the join link", async ({ baseURL, members, request, session }) => {
    const { roomId, joinCode } = await invitation(request, session);
    const context = { permissions: ["clipboard-read", "clipboard-write"] };
    const ada = await members.signIn("Ada", { path: `/rooms/${roomId}`, serverRooms: true, context });
    const copy = ada.page.getByRole("button", { name: "Copy join link" });
    await copy.click();
    await expect(copy).toHaveClass(/animate-success/);
    expect(await ada.page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/join/${joinCode}`, baseURL).href);
  });

  test("shares the join link where the browser can share", async ({ baseURL, members, request, session }) => {
    const { roomId, joinCode } = await invitation(request, session);
    const ada = await members.signIn("Ada", {
      path: `/rooms/${roomId}`,
      serverRooms: true,
      beforeOpen: async (page) => {
        await page.addInitScript(() => {
          Object.defineProperties(Navigator.prototype, {
            canShare: { value: () => true, configurable: true },
            share: { value: async (data: ShareData) => void ((window as unknown as { shared: ShareData }).shared = data), configurable: true },
          });
        });
      },
    });
    await ada.page.getByRole("button", { name: "Share join link" }).click();
    // The stand-in for the system's share sheet kept what the page shared.
    await expect.poll(() => ada.page.evaluate(() => (window as unknown as { shared?: ShareData }).shared)).toEqual({
      title: "Link to join Ember",
      text: "Hit this link to join me in Ember and start chatting.",
      url: new URL(`/join/${joinCode}`, baseURL).href,
    });
  });

  test("offers only Copy where the browser can't share", async ({ members, request, session }) => {
    const { roomId } = await invitation(request, session);
    const ada = await members.signIn("Ada", {
      path: `/rooms/${roomId}`,
      serverRooms: true,
      beforeOpen: async (page) => {
        await page.addInitScript(() => {
          const navigator = Navigator.prototype as Partial<Navigator>;
          delete navigator.canShare;
          delete navigator.share;
        });
      },
    });
    await expect(ada.page.getByRole("button", { name: "Copy join link" })).toBeVisible();
    await expect(ada.page.getByRole("button", { name: "Share join link" })).toHaveCount(0);
  });
});

test.describe(feature("accounts.qr-codes"), () => {
  test("opens the join link's QR code in the image viewer", async ({ baseURL, members, request, session }) => {
    const { roomId, joinCode } = await invitation(request, session);
    const ada = await members.signIn("Ada", { path: `/rooms/${roomId}`, serverRooms: true });
    // The join link as padded URL-safe base64.
    const qrCode = `/qr_code/${Buffer.from(new URL(`/join/${joinCode}`, baseURL).href).toString("base64").replace(/\+/g, "-").replace(/\//g, "_")}`;
    const show = ada.page.getByRole("link", { name: "Show join link QR code" });
    await expect(show).toHaveAttribute("href", qrCode);

    const drawn = ada.page.waitForResponse((response) => new URL(response.url()).pathname === qrCode);
    await show.click();
    const response = await drawn;
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/svg+xml; charset=utf-8");
    const viewer = ada.page.getByRole("dialog", { name: "Image Viewer (Press escape to close)" });
    await expect(viewer.locator(`img[src="${qrCode}"]`)).toBeVisible();
    await expect(viewer.getByRole("link", { name: "Download file" })).toHaveAttribute("href", qrCode);
    await expect(viewer.getByRole("button", { name: "Close image viewer" })).toBeFocused();

    // It saves the code and stays open, where ember-rust's link leaves the app to show it.
    const download = ada.page.waitForEvent("download");
    await viewer.getByRole("link", { name: "Download file" }).click();
    expect((await download).suggestedFilename()).toBe("QR code.svg");
    await expect(viewer).toBeVisible();
    expect(new URL(ada.page.url()).pathname).toBe(`/rooms/${roomId}`);

    await ada.page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(show).toBeFocused();

    await show.click();
    await viewer.getByRole("button", { name: "Close image viewer" }).click();
    await expect(viewer).toBeHidden();
    await expect(viewer.locator("img[src^='/qr_code/']")).toHaveCount(0);
  });
});
