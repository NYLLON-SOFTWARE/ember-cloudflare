import { feature } from "@ember/parity";
import { invitation } from "../../fixtures";
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

test.describe(feature("rooms.show"), () => {
  test("opens the room named in the address", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada", { path: `/rooms/${rooms.random.id}` });
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("random");
  });

  test("opens the first room for an address naming a room that doesn't exist", async ({ members }) => {
    const ada = await members.signIn("Ada", { path: "/rooms/nowhere" });
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
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

    await ada.page.keyboard.press("Escape");
    await expect(viewer).toBeHidden();
    await expect(show).toBeFocused();

    await show.click();
    await viewer.getByRole("button", { name: "Close image viewer" }).click();
    await expect(viewer).toBeHidden();
    await expect(viewer.locator("img[src^='/qr_code/']")).toHaveCount(0);
  });
});
