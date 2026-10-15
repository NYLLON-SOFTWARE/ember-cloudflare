import { feature } from "@ember/parity";
import type { APIRequestContext } from "@playwright/test";
import { cookieHeader } from "../../fixtures";
import { expect, test, unique, type Member } from "./fixtures";

/** Starts a DM between `member` and `others` through the API, as New direct message does, and returns its id. */
async function startDirect(request: APIRequestContext, member: Member, others: Member[]): Promise<string> {
  const userIds = others.map(({ session }) => session.user.id);
  const response = await request.post("/api/directs", { data: { userIds }, headers: { Cookie: cookieHeader(member.session) } });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { room: { id: string } }).room.id;
}

/** `member`'s sidebar row for their DM with `others`, named for them in the order the DM lists them, which is by id. */
function directRow(member: Member, others: Member[]) {
  const names = [...others].sort((a, b) => (a.session.user.id < b.session.user.id ? -1 : 1)).map(({ name }) => name);
  return member.page.getByRole("region", { name: "DMs" }).getByRole("link", { name: `Direct message with ${names.join(", ")}`, exact: true });
}

const settingsLink = (member: Member) => member.page.getByRole("link", { name: "Settings for this Ping" });

/** New direct message, while it's open. */
const newDirect = (member: Member) => member.page.getByRole("dialog", { name: "New direct message" });

/** The rail's DMs, which opens New direct message. */
const dmsLink = (member: Member) => member.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "DMs" });

/** Picks `others` in New direct message, finding each by their name, which no one else has. */
async function pick(member: Member, others: Member[]): Promise<void> {
  const search = newDirect(member).getByRole("combobox", { name: "Search people" });
  for (const other of others) {
    await search.fill(other.name);
    await newDirect(member).getByRole("option", { name: other.name, exact: true }).click();
  }
}

test.describe(feature("dms.create"), () => {
  test("lists a DM in its members' sidebars as it starts, and they talk there", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await expect(ada.page.getByRole("region", { name: "DMs" })).toContainText("No direct messages yet.");
    const roomId = await startDirect(request, ada, [grace]);

    await expect(directRow(ada, [grace])).toBeVisible();
    await expect(ada.page.getByRole("region", { name: "DMs" })).not.toContainText("No direct messages yet.");
    await directRow(grace, [ada]).click();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
    await expect(grace.page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${ada.name}`);
    await expect(grace.page).toHaveTitle(ada.name);
    await grace.connected();
    await expect(grace.composer()).toHaveAttribute("placeholder", `Message ${ada.name}`);
    await expect(directRow(grace, [ada])).toHaveAttribute("aria-current", "page");
    await grace.send("Hello, Ada");

    await directRow(ada, [grace]).click();
    await ada.connected();
    await expect(ada.message("Hello, Ada")).toBeVisible();
  });
});

test.describe(feature("dms.naming"), () => {
  test("names a group DM for the others in it, in the sidebar, its header, the tab and its settings", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const linus = await members.signIn(unique("Linus"));
    const roomId = await startDirect(request, grace, [ada, linus]);
    const [first, second] = [grace, linus].sort((a, b) => (a.session.user.id < b.session.user.id ? -1 : 1)).map(({ name }) => name);

    await directRow(ada, [grace, linus]).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${first} and ${second}`);
    await expect(ada.page).toHaveTitle(`${first} and ${second}`);
    // Two faces in a grid for the two others.
    await expect(directRow(ada, [grace, linus]).locator("img")).toHaveCount(2);

    await settingsLink(ada).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));
    await expect(ada.page).toHaveTitle(`Edit settings for ${first} and ${second}`);
    await expect(ada.page.getByRole("main").locator("strong")).toHaveText([first!, second!]);
    await ada.page.getByRole("link", { name: "Go Back" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
  });
});

test.describe(feature("dms.delete"), () => {
  test("deletes a DM from its settings for anyone in it who confirms, and the others find it deleted", async ({ members, request, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const roomId = await startDirect(request, ada, [grace]);
    await directRow(ada, [grace]).click();
    await ada.connected();

    // Grace didn't start it.
    await directRow(grace, [ada]).click();
    await settingsLink(grace).click();
    const remove = grace.page.getByRole("button", { name: "Delete Ping" });
    // Saying no keeps it.
    grace.page.once("dialog", (dialog) => void dialog.dismiss());
    await remove.click();
    await expect(remove).toBeEnabled();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));

    const asked = new Promise<string>((resolve) =>
      grace.page.once("dialog", (dialog) => {
        resolve(dialog.message());
        void dialog.accept();
      }),
    );
    await remove.click();
    expect(await asked).toBe("Are you sure you want to delete this ping and all messages in it? This can’t be undone.");
    // Home, which is the room before the DM, since the DM it last showed is gone.
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(grace.page.getByRole("alert")).toHaveCount(0);
    await expect(directRow(grace, [ada])).toHaveCount(0);

    await expect(ada.page.getByRole("alert")).toHaveText("This room was deleted.");
    await expect(ada.composer()).toHaveCount(0);
    await expect(directRow(ada, [grace])).toHaveCount(0);
  });

  test("keeps a DM's settings until their deletion answers, though the Workspace says it's gone first, then goes home without an alert", async ({ members, request, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const roomId = await startDirect(request, ada, [grace]);
    await directRow(grace, [ada]).click();
    await settingsLink(grace).click();
    // The deletion answers only once the test lets it, by when the Workspace has said the DM's gone.
    let answer = () => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    await grace.page.route(`**/api/rooms/${roomId}`, async (route) => {
      if (route.request().method() !== "DELETE") return route.fallback();
      const response = await route.fetch();
      await answered;
      await route.fulfill({ response });
    });
    const remove = grace.page.getByRole("button", { name: "Delete Ping" });
    grace.page.once("dialog", (dialog) => void dialog.accept());
    await remove.click();

    await expect(directRow(grace, [ada])).toHaveCount(0);
    await expect(remove).toBeDisabled();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));
    answer();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(grace.page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe(feature("dms.picker"), () => {
  test("starts a DM with the people picked from the rail's DMs, and goes there for its composer to take focus", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const linus = await members.signIn(unique("Linus"));
    await dmsLink(ada).click();
    await expect(newDirect(ada)).toBeVisible();
    await expect(newDirect(ada).getByRole("combobox", { name: "Search people" })).toBeFocused();
    await pick(ada, [grace, linus]);
    await expect(newDirect(ada).getByRole("group", { name: "Selected people" }).getByRole("button")).toHaveText([`${grace.name} ×`, `${linus.name} ×`]);
    await newDirect(ada).getByRole("button", { name: "Start conversation" }).click();

    await expect(newDirect(ada)).toBeHidden();
    await expect(directRow(ada, [grace, linus])).toHaveAttribute("aria-current", "page");
    await ada.connected();
    await expect(ada.composer()).toBeFocused();
    await ada.send("Hello, both");
    await directRow(grace, [ada, linus]).click();
    await grace.connected();
    await expect(grace.message("Hello, both")).toBeVisible();
  });

  test("opens the DM a group already has, from the sidebar's New direct message", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    const roomId = await startDirect(request, grace, [ada]);
    await expect(directRow(ada, [grace])).toBeVisible();
    await ada.page.getByRole("region", { name: "DMs" }).getByRole("link", { name: "New direct message" }).click();
    await pick(ada, [grace]);
    await newDirect(ada).getByRole("button", { name: "Start conversation" }).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
    await expect(directRow(ada, [grace])).toHaveCount(1);
  });

  test("opens in a new tab, over the last room visited, from DMs clicked with a modifier key", async ({ members, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    await expect(dmsLink(ada)).toHaveAttribute("href", "/rooms/directs/new");
    const [tab] = await Promise.all([ada.page.context().waitForEvent("page"), dmsLink(ada).click({ modifiers: ["ControlOrMeta"] })]);
    await expect(tab.getByRole("dialog", { name: "New direct message" })).toBeVisible();
    await expect(tab).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await tab.keyboard.press("Escape");
    await expect(tab.getByRole("dialog")).toBeHidden();
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText(rooms.general.name);
    // The tab it was clicked in stays as it was.
    await expect(newDirect(ada)).toBeHidden();
  });

  test("asks about a form's unsaved changes before starting a DM, and Keep editing goes back to the people picked", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await ada.page.goto("/rooms/opens/new");
    await ada.page.getByRole("textbox", { name: "Room name" }).fill(unique("Design"));
    await dmsLink(ada).click();
    await pick(ada, [grace]);
    const start = newDirect(ada).getByRole("button", { name: "Start conversation" });
    await start.click();
    const unsaved = ada.page.getByRole("dialog", { name: "Unsaved Changes" });
    await unsaved.getByRole("button", { name: "Keep editing" }).click();
    await expect(unsaved).toBeHidden();
    await expect(newDirect(ada).getByRole("button", { name: `Remove ${grace.name}` })).toBeVisible();
    await expect(ada.page).toHaveURL(/\/rooms\/opens\/new$/);

    await start.click();
    await unsaved.getByRole("button", { name: "Discard" }).click();
    await expect(directRow(ada, [grace])).toHaveAttribute("aria-current", "page");
    await ada.connected();
  });
});
