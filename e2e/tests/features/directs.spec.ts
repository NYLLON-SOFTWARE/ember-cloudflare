import { feature } from "@ember/parity";
import type { APIRequestContext } from "@playwright/test";
import { cookieHeader } from "../../fixtures";
import { expect, test, unique, type Member } from "./fixtures";

/** Starts a DM between `member` and `others` through the API, as New direct message will, and returns its id. */
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
});
