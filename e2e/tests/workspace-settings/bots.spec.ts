import { feature } from "@ember/parity";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { join } from "./fixtures";

/** A command that posts to a room as a bot: its room's address on this server, then the bot's key. */
const COMMAND = /^curl -d 'Hello!' https:\/\/127\.0\.0\.1:\d+\/rooms\/[^/]+\/[^/]+-[A-Za-z0-9]{12}\/messages$/;

/** A bot's entry on the bots page. */
const botNamed = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

/** Signs the administrator in on the bots page, from workspace settings' Chat bots. */
async function openBots(page: Page) {
  await useOwnAddress(page);
  await page.goto("/account/edit");
  await signInAsAdministrator(page);
  await page.getByRole("link", { name: "Chat bots" }).click();
  await expect(page).toHaveURL(/\/account\/bots$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chat bots");
}

/** Adds a bot named `name`, from the bots page, back to which it goes. A server kept from an earlier run may have bots already. */
async function addBot(page: Page, name: string, webhookUrl = "") {
  await page.getByRole("link", { name: "Add a chat bot" }).click();
  await expect(page).toHaveURL(/\/account\/bots\/new$/);
  await page.getByRole("textbox", { name: "Bot name" }).fill(name);
  await page.getByRole("textbox", { name: "Webhook URL" }).fill(webhookUrl);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/account\/bots$/);
}

/** Adds a bot named `name` and opens general, answering the address the bot's command posts there to. */
async function openGeneralFor(page: Page, name: string): Promise<string> {
  await openBots(page);
  await addBot(page, name);
  const command = botNamed(page, name).getByRole("group", { name: "general", exact: true }).getByRole("textbox", { name: "curl command for posting messages" });
  const url = (await command.inputValue()).split(" ").at(-1)!;
  // The room the command posts to, open in the administrator's browser.
  await page.goto(new URL(url).pathname.replace(/\/[^/]+\/messages$/, ""));
  await expect(page.getByRole("textbox", { name: "Write a message" })).toBeVisible();
  return url;
}

/** As `curl -d` sends a body. */
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

/** The address of the message a bot's post made, under the room's address for the bot, `url`. */
const messageUrl = (url: string, posted: APIResponse) => `${url}/${posted.headers()["location"]!.split("/@")[1]}`;

test.describe(feature("bots.create-edit"), () => {
  test("the administrator adds a bot, which gets commands for posting to every open room, and renames it", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await addBot(page, name, "https://ci.example.com/hook");

    // A new bot joins every open room, as someone new does, first run's general among them.
    const general = botNamed(page, name).getByRole("group", { name: "general", exact: true });
    await expect(general.getByRole("textbox", { name: "curl command for posting messages" })).toHaveValue(COMMAND);
    await expect(general.getByRole("textbox", { name: "curl command for posting attachments" })).toHaveValue(/^curl -F "attachment=@\/path\/to\/file" https:/);

    await botNamed(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    await expect(page).toHaveURL(/\/account\/bots\/[^/]+\/edit$/);
    await expect(page.getByRole("textbox", { name: "Bot name" })).toHaveValue(name);
    await expect(page.getByRole("textbox", { name: "Webhook URL" })).toHaveValue("https://ci.example.com/hook");
    const renamed = `Deploy Bot ${crypto.randomUUID().slice(0, 8)}`;
    await page.getByRole("textbox", { name: "Bot name" }).fill(renamed);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);
    await expect(botNamed(page, renamed)).toBeVisible();
    await expect(botNamed(page, name)).toHaveCount(0);
  });
});

test.describe(feature("bots.reset-key"), () => {
  test("the administrator gives a bot a new key after asking, which its commands then carry", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await addBot(page, name);
    const command = botNamed(page, name).getByRole("group", { name: "general", exact: true }).getByRole("textbox", { name: "curl command for posting messages" });
    const before = await command.inputValue();

    await botNamed(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe("Are you sure you want to change the bot key? All usage of this bot must be updated.");
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Generate a new key" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);
    await expect(command).toHaveValue(COMMAND);
    expect(await command.inputValue()).not.toBe(before);
  });
});

test.describe(feature("bots.delete"), () => {
  test("the administrator deletes a bot after asking, which leaves the bots page, and its settings answer 404", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await addBot(page, name);
    await botNamed(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    await expect(page).toHaveURL(/\/account\/bots\/[^/]+\/edit$/);
    const settings = new URL(page.url()).pathname;

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toBe("Are you sure you want to permanently remove this bot from the account? This can’t be undone.");
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Delete this chat bot" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Chat bots");
    await expect(botNamed(page, name)).toHaveCount(0);

    expect((await page.goto(settings))?.status()).toBe(404);
  });
});

test.describe(feature("bots.api-post"), () => {
  test("a bot's command posts to its room as the bot, which shows there at once, and the bot reads it back", async ({ page }) => {
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    const url = await openGeneralFor(page, name);
    const text = `Deploy finished ${crypto.randomUUID().slice(0, 8)}`;
    const posted = await page.request.post(url, { data: text, headers: FORM });
    expect(posted.status()).toBe(201);
    const message = page.getByRole("article").filter({ hasText: text });
    await expect(message).toBeVisible();
    await expect(message).toContainText(name);

    const read = await page.request.get(url);
    expect(read.status()).toBe(200);
    expect(((await read.json()) as Array<{ body: { plain_text: string }; creator: { name: string } }>).at(-1)).toMatchObject({ body: { plain_text: text }, creator: { name } });
  });
});

test.describe(feature("bots.api-edit-delete"), () => {
  test("a bot edits its message, then deletes it, which the room shows at once", async ({ page }) => {
    const url = await openGeneralFor(page, `Build Bot ${crypto.randomUUID().slice(0, 8)}`);
    const tag = crypto.randomUUID().slice(0, 8);
    const message = messageUrl(url, await page.request.post(url, { data: `Deploying ${tag}`, headers: FORM }));
    await expect(page.getByRole("article").filter({ hasText: `Deploying ${tag}` })).toBeVisible();

    expect((await page.request.patch(message, { data: `Deployed ${tag}`, headers: FORM })).status()).toBe(200);
    const edited = page.getByRole("article").filter({ hasText: `Deployed ${tag}` });
    await expect(edited).toContainText("(edited)");
    await expect(page.getByRole("article").filter({ hasText: `Deploying ${tag}` })).toHaveCount(0);

    expect((await page.request.delete(message)).status()).toBe(204);
    await expect(edited).toHaveCount(0);
  });
});

test.describe(feature("bots.api-boosts"), () => {
  test("a bot boosts a message, then takes its boost back, which the room shows at once", async ({ page }) => {
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    const url = await openGeneralFor(page, name);
    const text = `Shipped ${crypto.randomUUID().slice(0, 8)}`;
    const message = messageUrl(url, await page.request.post(url, { data: text, headers: FORM }));

    const boosted = await page.request.post(`${message}/boosts`, { data: "🎉", headers: FORM });
    expect(boosted.status()).toBe(201);
    const boost = page.getByRole("article").filter({ hasText: text }).getByRole("img", { name: `${name} boosted 🎉` });
    await expect(boost).toBeVisible();

    const { id } = (await boosted.json()) as { id: string };
    expect((await page.request.delete(`${message}/boosts/${id}`)).status()).toBe(204);
    await expect(boost).toHaveCount(0);
  });
});

test.describe(feature("bots.list"), () => {
  test("a member who opens the bot pages is sent to workspace settings, told why", async ({ page, browser, baseURL }) => {
    await useOwnAddress(page);
    await page.goto("/account/edit");
    await signInAsAdministrator(page);
    const member = await join(browser, baseURL!, await page.getByRole("textbox", { name: "Share to invite more people" }).inputValue(), "Grace Hopper");

    for (const path of ["/account/bots", "/account/bots/new"]) {
      await member.goto(path);
      await expect(member.getByRole("alert")).toHaveText("Only administrators can manage bots");
      await expect(member).toHaveURL(/\/account\/edit$/);
      await expect(member.getByRole("heading", { level: 1 })).toHaveText("Workspace settings");
      await expect(member.getByRole("link", { name: "Chat bots" })).toHaveCount(0);
    }
    await member.context().close();
  });
});
