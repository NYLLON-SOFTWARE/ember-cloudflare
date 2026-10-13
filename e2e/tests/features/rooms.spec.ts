import { feature } from "@ember/parity";
import { expect, test } from "./fixtures";

test.describe(feature("sidebar.rooms"), () => {
  test("lists the rooms the server has", async ({ members }) => {
    const ada = await members.signIn("Ada", { path: "/", serverRooms: true });
    const response = await ada.page.request.get("/api/rooms", { headers: { authorization: `Bearer ${ada.session.token}` } });
    const { rooms } = (await response.json()) as { rooms: { name: string }[] };
    expect(rooms.length).toBeGreaterThan(0);
    await expect(ada.page.getByRole("region", { name: "Rooms" }).getByRole("link")).toHaveText(rooms.map((room) => `#${room.name}`));
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
