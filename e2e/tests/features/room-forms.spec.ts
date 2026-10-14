import { feature } from "@ember/parity";
import type { APIRequestContext } from "@playwright/test";
import { cookieHeader, createSession, signInAs, type Session, type TestRoom } from "../../fixtures";
import { expect, Member, test } from "./fixtures";

/** A name no other test's people or rooms have, since they all share the server. */
const unique = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

/** The id of the room `member` is in, from the address. */
const roomIdOf = (member: Member) => new URL(member.page.url()).pathname.split("/").pop()!;

/** Creates a private room through the API as `session`'s person, for exactly `members`. */
async function createPrivateRoom(request: APIRequestContext, session: Session, name: string, members: Session[]): Promise<TestRoom> {
  const memberIds = members.map(({ user }) => user.id);
  const response = await request.post("/api/rooms", { data: { kind: "closed", name, memberIds }, headers: { Cookie: cookieHeader(session) } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { room: TestRoom }).room;
}

/** Whether `session`'s person can see the room `roomId`, as its settings answer. */
async function canSee(request: APIRequestContext, session: Session, roomId: string): Promise<boolean> {
  const response = await request.get(`/api/rooms/${roomId}/settings`, { headers: { Cookie: cookieHeader(session) } });
  expect([200, 404], await response.text()).toContain(response.status());
  return response.status() === 200;
}

test.describe(feature("rooms.create-open"), () => {
  test("makes an open room from workspace settings, opens it, and lets everyone in", async ({ members, request }) => {
    const ada = await members.signIn("Ada");
    const rail = ada.page.getByRole("navigation", { name: "Workspace" });
    await expect(rail.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
    await rail.getByRole("link", { name: "Workspace" }).click();
    await expect(ada.page).toHaveURL(/\/account\/edit$/);
    await expect(ada.page).toHaveTitle("Account settings");
    await expect(rail.getByRole("link", { name: "Workspace" })).toHaveAttribute("aria-current", "page");

    await ada.page.getByRole("link", { name: "New room" }).click();
    await expect(ada.page).toHaveURL(/\/rooms\/opens\/new$/);
    await expect(ada.page).toHaveTitle("New chat room");
    const roomName = ada.page.getByRole("textbox", { name: "Room name" });
    await expect(roomName).toHaveValue("New room");
    await expect(roomName).toBeFocused();
    await expect(ada.page.getByRole("switch", { name: "Give only some access to this room" })).toBeChecked();

    const name = unique("Design");
    await roomName.fill(name);
    await roomName.press("Enter");
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(ada.page.getByRole("region", { name: "Rooms" }).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    await ada.connected();
    expect(await canSee(request, await createSession(request, "Grace"), roomIdOf(ada))).toBe(true);
  });
});

test.describe(feature("rooms.create-closed"), () => {
  test("makes a private room for you and the people chosen", async ({ members, request }) => {
    const [grace, linus] = [await createSession(request, unique("Grace")), await createSession(request, unique("Linus"))];
    const ada = await members.signIn("Ada");
    await ada.page.goto("/rooms/opens/new");
    const roomName = ada.page.getByRole("textbox", { name: "Room name" });
    const name = unique("Leads");
    await roomName.fill(name);

    await ada.page.getByRole("switch", { name: "Give only some access to this room" }).click();
    await expect(ada.page).toHaveURL(/\/rooms\/closeds\/new$/);
    await expect(roomName).toHaveValue(name);
    await expect(ada.page.getByRole("switch", { name: "Give everyone access to this room" })).not.toBeChecked();
    const graceSwitch = ada.page.getByRole("switch", { name: `Give ${grace.user.name} access to this room` });
    await expect(graceSwitch).not.toBeChecked();
    await graceSwitch.click();
    await ada.page.getByRole("button", { name: "Save" }).click();

    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(name);
    await ada.connected();
    const roomId = roomIdOf(ada);
    expect(await canSee(request, grace, roomId)).toBe(true);
    expect(await canSee(request, linus, roomId)).toBe(false);
  });
});

test.describe(feature("rooms.settings-page"), () => {
  test("renames a room from the settings in its header", async ({ page, rooms, session }) => {
    // As the person who made this test's rooms, who can change them.
    await signInAs(page, session);
    await page.goto(`/rooms/${rooms.general.id}`);
    await new Member(page, session).connected();

    const settings = page.getByRole("link", { name: "Settings for this room" });
    await expect(settings).toHaveAttribute("title", "Conversation settings");
    await settings.click();
    await expect(page).toHaveURL(new RegExp(`/rooms/opens/${rooms.general.id}/edit$`));
    await expect(page).toHaveTitle("Edit settings for general");
    await expect(page.getByRole("heading", { level: 1, name: "Room settings" })).toBeVisible();
    // A room's settings are no rail link's page.
    await expect(page.getByRole("navigation", { name: "Workspace" }).locator("[aria-current=page]")).toHaveCount(0);

    const roomName = page.getByRole("textbox", { name: "Room name" });
    await expect(roomName).toHaveValue("general");
    await roomName.fill("lobby");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("lobby");
    await expect(page.getByRole("region", { name: "Rooms" }).getByRole("link")).toHaveText(["#lobby", "#random"]);

    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("lobby");
  });
});

test.describe(feature("rooms.edit-permissions"), () => {
  test("shows other members a room's settings with nothing to change them with", async ({ members, rooms }) => {
    const ada = await members.signIn("Ada");
    await ada.page.getByRole("link", { name: "Settings for this room" }).click();
    await expect(ada.page.getByRole("heading", { level: 2, name: "general" })).toBeVisible();
    await expect(ada.page.getByRole("main").getByRole("listitem").first()).toHaveText("Everyone");
    await expect(ada.page.getByRole("textbox", { name: "Room name" })).toHaveCount(0);
    await expect(ada.page.getByRole("button", { name: "Save" })).toHaveCount(0);

    await ada.page.getByRole("link", { name: "Go Back" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
  });

  test("goes home with an alert from the settings of a room you aren't in", async ({ members, request }) => {
    const grace = await createSession(request, "Grace");
    const secret = await createPrivateRoom(request, grace, unique("Secret"), [grace]);
    const ada = await members.signIn("Ada");
    await ada.page.goto(`/rooms/closeds/${secret.id}/edit`);
    await expect(ada.page.getByRole("alert")).toHaveText("Room not found or inaccessible");
    await expect(ada.page).toHaveURL(/\/$/);
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
  });
});

test.describe(feature("rooms.members"), () => {
  test("adds and removes a private room's people, and someone removed who has it open finds it gone", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { serverRooms: true });
    const linus = await members.signIn(unique("Linus"), { serverRooms: true });
    const grace = await createSession(request, unique("Grace"));
    const leads = await createPrivateRoom(request, linus.session, unique("Leads"), [linus.session, ada.session]);
    await ada.page.goto(`/rooms/${leads.id}`);
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(leads.name);
    await ada.connected();

    await linus.page.goto(`/rooms/closeds/${leads.id}/edit`);
    const accessFor = (name: string) => linus.page.getByRole("switch", { name: `Give ${name} access to this room` });
    await expect(accessFor(ada.name)).toBeChecked();
    await expect(accessFor(grace.user.name)).not.toBeChecked();
    await accessFor(grace.user.name).click();
    await accessFor(ada.name).click();
    await linus.page.getByRole("button", { name: "Save" }).click();
    await expect(linus.page).toHaveURL(new RegExp(`/rooms/${leads.id}$`));

    await expect(ada.page.getByRole("alert")).toHaveText("This room was deleted.");
    await expect(ada.composer()).toHaveCount(0);
    await expect(ada.page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: leads.name })).toHaveCount(0);
    expect(await canSee(request, ada.session, leads.id)).toBe(false);
    expect(await canSee(request, grace, leads.id)).toBe(true);
  });

  test("goes home with an alert when you save a private room without yourself", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { serverRooms: true });
    const leads = await createPrivateRoom(request, ada.session, unique("Leads"), [ada.session]);
    await ada.page.goto(`/rooms/closeds/${leads.id}/edit`);
    await ada.page.getByRole("switch", { name: `Give ${ada.name} access to this room` }).click();
    await ada.page.getByRole("button", { name: "Save" }).click();
    await expect(ada.page.getByRole("alert")).toHaveText("Room not found or inaccessible");
    await expect(ada.page).toHaveURL(/\/$/);
    await expect(ada.page.getByRole("region", { name: "Rooms" }).getByRole("link", { name: leads.name })).toHaveCount(0);
    expect(await canSee(request, ada.session, leads.id)).toBe(false);
  });
});

test.describe(feature("rooms.convert-access"), () => {
  test("opens a private room to everyone with the Everyone switch", async ({ members, request }) => {
    const linus = await members.signIn(unique("Linus"), { serverRooms: true });
    const grace = await createSession(request, unique("Grace"));
    const leads = await createPrivateRoom(request, linus.session, unique("Leads"), [linus.session]);
    await linus.page.goto(`/rooms/closeds/${leads.id}/edit`);
    await linus.page.getByRole("switch", { name: "Give everyone access to this room" }).click();
    await expect(linus.page).toHaveURL(new RegExp(`/rooms/opens/${leads.id}/edit$`));
    await expect(linus.page.getByRole("switch", { name: "Give only some access to this room" })).toBeChecked();
    await linus.page.getByRole("button", { name: "Save" }).click();

    await expect(linus.page).toHaveURL(new RegExp(`/rooms/${leads.id}$`));
    await linus.connected();
    expect(await canSee(request, grace, leads.id)).toBe(true);
    // Its settings now open at the open room's address.
    await expect(linus.page.getByRole("link", { name: "Settings for this room" })).toHaveAttribute("href", `/rooms/opens/${leads.id}/edit`);
  });
});

test.describe(feature("ui.flash"), () => {
  test("centers an alert over the page beside the rail and sidebar", async ({ members }) => {
    const ada = await members.signIn("Ada", { context: { viewport: { width: 1280, height: 800 } } });
    await ada.page.goto("/rooms/opens/nowhere/edit");
    const alert = ada.page.getByRole("alert");
    await expect(alert).toHaveText("Room not found or inaccessible");
    const box = (await alert.boundingBox())!;
    // Halfway between the sidebar's edge, 80px of rail and 280px of sidebar in, and the window's.
    expect(Math.round(box.x + box.width / 2)).toBe((360 + 1280) / 2);
  });
});
