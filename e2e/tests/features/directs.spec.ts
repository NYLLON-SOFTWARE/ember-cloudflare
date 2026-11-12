import type { Sidebar } from "@ember/protocol";
import { answerConfirm, cookieHeader } from "../../fixtures";
import { expect, startDirect, test, unique, type Member } from "./fixtures";

/** The DMs page's list, which shows on the DMs page, beside a DM and beside a DM's settings. */
const dmsList = (member: Member) => member.page.getByRole("region", { name: "Direct messages" });

/** `member`'s row for their DM with `others`, named for them in the order the DM lists them, which is by id. */
function directRow(member: Member, others: Member[]) {
  const names = [...others].sort((a, b) => (a.session.user.id < b.session.user.id ? -1 : 1)).map(({ name }) => name);
  return dmsList(member).getByRole("link", { name: `Direct message with ${names.join(", ")}`, exact: true });
}

/** `member`'s DM rows, top to bottom. */
const directRows = (member: Member) => dmsList(member).getByRole("link", { name: /^Direct message with / });

/** `member`'s rows suggesting people for DMs, top to bottom. */
const suggestionRows = (member: Member) => dmsList(member).getByRole("button", { name: /^Start a direct message with / });

const settingsLink = (member: Member) => member.page.getByRole("link", { name: "Settings for this DM" });

/** New direct message, while it's open. */
const newDirect = (member: Member) => member.page.getByRole("dialog", { name: "New direct message" });

/** The rail's DMs, which opens the DMs page. */
const dmsLink = (member: Member) => member.page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "DMs" });

/** The DMs page's New direct message, which opens the dialog. */
const composeLink = (member: Member) => member.page.getByRole("link", { name: "New direct message" });

/** Opens the DMs page from the rail. */
async function openDms(member: Member): Promise<void> {
  await dmsLink(member).click();
  await expect(member.page).toHaveURL(/\/dms$/);
}

/** Picks `others` in New direct message, finding each by their name, which no one else has. */
async function pick(member: Member, others: Member[]): Promise<void> {
  const search = newDirect(member).getByRole("combobox", { name: "Search people" });
  for (const other of others) {
    await search.fill(other.name);
    await newDirect(member).getByRole("option", { name: other.name, exact: true }).click();
  }
}

test.describe("Start or reopen a direct message", () => {
  test("lists a DM on its members' DMs pages as it starts, and they talk there", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"), { path: "/dms" });
    await expect(directRows(ada)).toHaveCount(0);
    const roomId = await startDirect(request, ada, [grace]);

    await expect(directRow(ada, [grace])).toBeVisible();
    await expect(directRows(ada)).toHaveCount(1);
    await directRow(grace, [ada]).click();
    await expect(grace.page).toHaveURL(new RegExp(`/dms/${roomId}$`));
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

test.describe("Group DMs and DM names", () => {
  test("names a group DM for the others in it, on the DMs page, its header, the tab and its settings", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"));
    const linus = await members.signIn(unique("Linus"));
    const roomId = await startDirect(request, grace, [ada, linus]);
    const [first, second] = [grace, linus].sort((a, b) => (a.session.user.id < b.session.user.id ? -1 : 1)).map(({ name }) => name);

    await directRow(ada, [grace, linus]).click();
    await expect(ada.page).toHaveURL(new RegExp(`/dms/${roomId}$`));
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${first} and ${second}`);
    await expect(ada.page).toHaveTitle(`${first} and ${second}`);
    // The two others' faces, overlapped.
    await expect(directRow(ada, [grace, linus]).locator("img")).toHaveCount(2);

    await settingsLink(ada).click();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));
    await expect(ada.page).toHaveTitle(`Edit settings for ${first} and ${second}`);
    await expect(ada.page.getByRole("main").locator("strong")).toHaveText([first!, second!]);
    await ada.page.getByRole("link", { name: "Go Back" }).click();
    // To the DM at its own address, which shows it beside the DMs list too.
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
    await expect(directRow(ada, [grace, linus])).toHaveAttribute("aria-current", "page");
  });
});

test.describe("Delete a direct message", () => {
  test("deletes a DM from its settings for anyone in it who confirms, and the others find it deleted", async ({ members, request, rooms }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"), { path: "/dms" });
    const roomId = await startDirect(request, ada, [grace]);
    await directRow(ada, [grace]).click();
    await ada.connected();

    // Grace didn't start it.
    await directRow(grace, [ada]).click();
    await settingsLink(grace).click();
    const remove = grace.page.getByRole("button", { name: "Delete DM" });
    // Saying no keeps it.
    await remove.click();
    await answerConfirm(grace.page, "Are you sure you want to delete this ping and all messages in it? This can’t be undone.", "Cancel");
    await expect(remove).toBeEnabled();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));

    await remove.click();
    await answerConfirm(grace.page, "Are you sure you want to delete this ping and all messages in it? This can’t be undone.", "Delete");
    // Home, which is the last room shown that isn't a DM.
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(grace.page.getByRole("alert")).toHaveCount(0);

    await expect(ada.page.getByRole("alert")).toHaveText("This room was deleted.");
    await expect(ada.composer()).toHaveCount(0);
    await expect(directRow(ada, [grace])).toHaveCount(0);
  });

  test("keeps a DM's settings until their deletion answers, though the Workspace says it's gone first, then goes home without an alert", async ({ members, request, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"), { path: "/dms" });
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
    const remove = grace.page.getByRole("button", { name: "Delete DM" });
    await remove.click();
    await answerConfirm(grace.page, "Are you sure you want to delete this ping", "Delete");

    // The DMs list beside the settings loses it.
    await expect(directRow(grace, [ada])).toHaveCount(0);
    await expect(remove).toBeDisabled();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/directs/${roomId}/edit$`));
    answer();
    await expect(grace.page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(grace.page.getByRole("alert")).toHaveCount(0);
  });
});

test.describe("DMs page", () => {
  test("opens from the rail's DMs, marked there, in place, or in a new tab with a modifier key", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    await expect(dmsLink(ada)).toHaveAttribute("href", "/dms");
    const [tab] = await Promise.all([ada.page.context().waitForEvent("page"), dmsLink(ada).click({ modifiers: ["ControlOrMeta"] })]);
    await expect(tab).toHaveURL(/\/dms$/);
    await expect(tab.getByRole("region", { name: "Direct messages" })).toBeVisible();
    // The tab it was clicked in stays as it was.
    await expect(dmsList(ada)).toHaveCount(0);

    await openDms(ada);
    await expect(dmsLink(ada)).toHaveAttribute("aria-current", "page");
    await expect(dmsList(ada)).toBeVisible();
  });
});

test.describe("New direct message dialog", () => {
  test("starts a DM with the people picked from the DMs page's New direct message, and goes there for its composer to take focus", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"), { path: "/dms" });
    const linus = await members.signIn(unique("Linus"));
    await composeLink(ada).click();
    await expect(newDirect(ada)).toBeVisible();
    await expect(newDirect(ada).getByRole("combobox", { name: "Search people" })).toBeFocused();
    await pick(ada, [grace, linus]);
    const picked = newDirect(ada).getByRole("group", { name: "Selected people" }).getByRole("button");
    await expect(picked).toHaveText([grace.name, linus.name]);
    await expect(picked.locator("svg")).toHaveCount(2);
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

  test("opens the DM a group already has, from the DMs page's New direct message, whose composer takes focus though the DM's shown", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"));
    const roomId = await startDirect(request, grace, [ada]);
    await expect(directRow(ada, [grace])).toBeVisible();
    const startWithGrace = async () => {
      await composeLink(ada).click();
      await pick(ada, [grace]);
      await newDirect(ada).getByRole("button", { name: "Start conversation" }).click();
      await expect(newDirect(ada)).toBeHidden();
    };
    await startWithGrace();
    await expect(ada.page).toHaveURL(new RegExp(`/rooms/${roomId}$`));
    await expect(directRow(ada, [grace])).toHaveCount(1);
    await ada.connected();
    await expect(ada.composer()).toBeFocused();

    // Started again from the DM, which stays as it is, its composer takes focus for typing at once.
    await startWithGrace();
    await expect(ada.composer()).toBeFocused();
    await ada.page.keyboard.type("Typed at once");
    await expect(ada.composer()).toHaveText("Typed at once");
  });

  test("opens in a new tab, over the last room visited, from New direct message clicked with a modifier key", async ({ members, rooms }) => {
    const ada = await members.signIn(unique("Ada"));
    await openDms(ada);
    await expect(composeLink(ada)).toHaveAttribute("href", "/rooms/directs/new");
    const [tab] = await Promise.all([ada.page.context().waitForEvent("page"), composeLink(ada).click({ modifiers: ["ControlOrMeta"] })]);
    await expect(tab.getByRole("dialog", { name: "New direct message" })).toBeVisible();
    await expect(tab).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await tab.keyboard.press("Escape");
    await expect(tab.getByRole("dialog")).toBeHidden();
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText(rooms.general.name);
    // The tab it was clicked in stays as it was.
    await expect(newDirect(ada)).toBeHidden();
  });

  test("asks about a form's unsaved changes before the rail's DMs leaves it, and Keep editing stays on the form", async ({ members }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await ada.page.goto("/rooms/opens/new");
    const name = ada.page.getByRole("textbox", { name: "Room name" });
    const typed = unique("Design");
    await name.fill(typed);
    await dmsLink(ada).click();
    const unsaved = ada.page.getByRole("dialog", { name: "Unsaved Changes" });
    await unsaved.getByRole("button", { name: "Keep editing" }).click();
    await expect(unsaved).toBeHidden();
    await expect(ada.page).toHaveURL(/\/rooms\/opens\/new$/);
    await expect(name).toHaveValue(typed);

    await dmsLink(ada).click();
    await unsaved.getByRole("button", { name: "Discard" }).click();
    await expect(ada.page).toHaveURL(/\/dms$/);
    // And a DM starts from there, as it would from anywhere.
    await composeLink(ada).click();
    await pick(ada, [grace]);
    await newDirect(ada).getByRole("button", { name: "Start conversation" }).click();
    await expect(directRow(ada, [grace])).toHaveAttribute("aria-current", "page");
    await ada.connected();
  });
});

test.describe("DM order", () => {
  test("lists the DM with the latest message first, moving it at once on everyone's DMs page, and keeps the order on reload", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    const grace = await members.signIn(unique("Grace"), { path: "/dms" });
    const linus = await members.signIn(unique("Linus"), { path: "/dms" });
    await startDirect(request, ada, [grace]);
    await startDirect(request, ada, [linus]);
    await startDirect(request, grace, [linus]);
    const names = (...others: Member[]) => others.map((other) => `Direct message with ${other.name}`);
    await expect(directRows(ada)).toHaveText(names(linus, grace).map((name) => new RegExp(`^${name}`)));
    await expect(directRows(grace)).toHaveText(names(linus, ada).map((name) => new RegExp(`^${name}`)));

    // Grace writes to Ada, which moves their DM to the top of both their lists.
    await directRow(grace, [ada]).click();
    await grace.connected();
    await grace.send("Hello, Ada");
    await expect(directRows(ada)).toHaveText(names(grace, linus).map((name) => new RegExp(`^${name}`)));
    await expect(directRows(grace)).toHaveText(names(ada, linus).map((name) => new RegExp(`^${name}`)));
    await expect(directRows(linus)).toHaveText(names(grace, ada).map((name) => new RegExp(`^${name}`)));

    await ada.page.reload();
    await expect(directRows(ada)).toHaveText(names(grace, linus).map((name) => new RegExp(`^${name}`)));
  });
});

test.describe("Suggested people", () => {
  test("starts a DM with someone suggested on the DMs page, who's suggested no more, and goes there for its composer to take focus", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"), { path: "/dms" });
    // Everyone new is suggested the server's oldest accounts, the administrator's first.
    const first = suggestionRows(ada).first();
    const name = (await first.textContent())!.replace(/^Start a direct message with/, "").trim();
    const [started] = await Promise.all([ada.page.waitForRequest((request) => request.url().endsWith("/api/directs") && request.method() === "POST"), first.click()]);
    const [personId] = (started.postDataJSON() as { userIds: string[] }).userIds;
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${name}`);
    await expect(ada.page).toHaveURL(/\/dms\/[^/]+$/);
    await expect(directRows(ada)).toHaveCount(1);
    await expect(directRows(ada)).toHaveAttribute("aria-current", "page");
    await ada.connected();
    await expect(ada.composer()).toBeFocused();

    const sidebar = await request.get("/api/sidebar", { headers: { Cookie: cookieHeader(ada.session) } });
    expect(((await sidebar.json()) as Sidebar).suggestions.map((person) => person.id)).not.toContain(personId);
  });
});
