import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { feature } from "@ember/parity";
import type { APIResponse, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ADMINISTRATOR, drawnPicture, editorField, nextSecond, shownPicture, signInAsAdministrator, useOwnAddress } from "../../fixtures";
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

/** Adds a bot named `name`, delivering to `webhookUrl` if it's given, and opens general, answering the address the bot's command posts there to. */
async function openGeneralFor(page: Page, name: string, webhookUrl?: string): Promise<string> {
  await openBots(page);
  await addBot(page, name, webhookUrl);
  const command = botNamed(page, name).getByRole("group", { name: "general", exact: true }).getByRole("textbox", { name: "curl command for posting messages" });
  const url = (await command.inputValue()).split(" ").at(-1)!;
  // The room the command posts to, open in the administrator's browser.
  await page.goto(new URL(url).pathname.replace(/\/[^/]+\/messages$/, ""));
  await expect(page.getByRole("textbox", { name: "Write a message" })).toBeVisible();
  return url;
}

/** A request a webhook got. */
interface Received {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

/**
 * Listens on this machine as a bot's webhook, answering each request with `answer`, by default an empty
 * 204, as a bot with nothing to say does.
 */
async function listenAsWebhook(answer = (response: ServerResponse) => response.writeHead(204).end()): Promise<{ url: string; received: Received[]; close: () => Promise<void> }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (body += chunk));
    request.on("end", () => {
      received.push({ method: request.method!, path: request.url!, headers: request.headers, body });
      answer(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hooks/build?team=ops`, received, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** Writes `text` in the room's composer, then mentions the bot `name` by `tag`, its name's own part, and sends it. */
async function mentionBot(page: Page, text: string, name: string, tag: string) {
  const composer = editorField(page, "Write a message");
  await composer.pressSequentially(text);
  await composer.pressSequentially("@");
  await expect(page.getByRole("listbox")).toBeVisible();
  // Waits for the people listed for the whole tag, as an answer for less of it may come later.
  const listed = page.waitForResponse((response) => new URL(response.url()).searchParams.get("filter") === tag);
  await composer.pressSequentially(tag);
  await listed;
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText([name]);
  await composer.press("Tab");
  await composer.press("Enter");
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

  test("the administrator gives a bot an avatar from its form, shown on the bots page as the variant the browser made, and a new one", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await page.getByRole("link", { name: "Add a chat bot" }).click();
    const preview = page.getByRole("img", { name: "Bot avatar" });
    // Campfire's default bot picture, until one is chosen.
    await expect(preview).toHaveAttribute("src", /svg/);
    await page.getByRole("textbox", { name: "Bot name" }).fill(name);
    await page.getByLabel("Upload bot avatar").setInputFiles(await drawnPicture(page, "robot.png", 1200, 800));
    await expect(preview).toHaveAttribute("src", /^blob:/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);

    const avatar = botNamed(page, name).getByRole("link", { name, exact: true }).locator("img");
    await expect(avatar).toHaveAttribute("src", /^\/users\/[^/]+\/avatar\?v=\d{14}$/);
    expect(await shownPicture(avatar)).toEqual({ type: "image/webp", width: 512, height: 341 });
    const first = (await avatar.getAttribute("src"))!;

    await botNamed(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    await expect(preview).toHaveAttribute("src", first);
    // An avatar's address changes with the second it was given, as ember-rust's does.
    await nextSecond();
    await page.getByLabel("Upload bot avatar").setInputFiles(await drawnPicture(page, "robot.png", 300, 600));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);
    await expect(avatar).not.toHaveAttribute("src", first);
    expect(await shownPicture(avatar)).toEqual({ type: "image/webp", width: 256, height: 512 });
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

  test("a bot posts a picture as `curl -F` sends one, which shows in the room at once as itself", async ({ page }) => {
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    const url = await openGeneralFor(page, name);
    const chart = await drawnPicture(page, `chart-${crypto.randomUUID().slice(0, 8)}.png`, 40, 20);
    expect((await page.request.post(url, { multipart: { attachment: chart } })).status()).toBe(201);

    const picture = page.getByRole("img", { name: chart.name });
    await expect(page.getByRole("article").filter({ has: picture })).toContainText(name);
    expect(await shownPicture(picture)).toEqual({ type: "image/png", width: 40, height: 20 });
  });
});

test.describe(feature("bots.slack-webhook"), () => {
  test("what a tool sends a bot's Slack-compatible webhook shows in its room at once, formatted, as the bot", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await addBot(page, name);
    const webhook = botNamed(page, name).getByRole("group", { name: "general", exact: true }).getByRole("textbox", { name: "Slack-compatible webhook URL" });
    await expect(webhook).toHaveValue(/^https:\/\/127\.0\.0\.1:\d+\/rooms\/[^/]+\/[^/]+-[A-Za-z0-9]{12}\/slack$/);
    const url = await webhook.inputValue();
    await page.goto(new URL(url).pathname.replace(/\/[^/]+\/slack$/, ""));
    await expect(page.getByRole("textbox", { name: "Write a message" })).toBeVisible();

    const build = crypto.randomUUID().slice(0, 8);
    const posted = await page.request.post(url, { data: { text: `Deploy *finished* :tada: <https://ci.example.com/builds/${build}|Build ${build}>`, username: "Impostor" } });
    expect([posted.status(), await posted.text()]).toEqual([200, "ok"]);
    const message = page.getByRole("article").filter({ hasText: `Build ${build}` });
    await expect(message).toContainText(name);
    const content = message.locator(".message-content");
    await expect(content).toHaveText(`Deploy finished 🎉 Build ${build}`);
    await expect(content.locator("strong")).toHaveText("finished");
    await expect(content.getByRole("link", { name: `Build ${build}` })).toHaveAttribute("href", `https://ci.example.com/builds/${build}`);
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

  test("a bot gives its message a file, shown in place of its text, then takes the file away, which the room shows at once", async ({ page }) => {
    const url = await openGeneralFor(page, `Build Bot ${crypto.randomUUID().slice(0, 8)}`);
    const tag = crypto.randomUUID().slice(0, 8);
    const message = messageUrl(url, await page.request.post(url, { data: `Build log ${tag}`, headers: FORM }));
    const text = page.getByRole("article").filter({ hasText: `Build log ${tag}` });
    await expect(text).toBeVisible();

    const log = { name: `build-${tag}.log`, mimeType: "text/plain", buffer: Buffer.from("All green\n") };
    expect((await page.request.put(message, { multipart: { attachment: log } })).status()).toBe(200);
    const file = page.getByRole("article").filter({ hasText: log.name });
    await expect(file.getByRole("link", { name: `Download ${log.name}` })).toBeVisible();
    await expect(file).toContainText("(edited)");
    await expect(text).toHaveCount(0);

    expect((await page.request.put(message, { multipart: { attachment: "" } })).status()).toBe(200);
    await expect(text).toContainText("(edited)");
    await expect(file).toHaveCount(0);
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

test.describe(feature("bots.webhook-delivery"), () => {
  test("mentioning a bot in the composer delivers the message to its webhook, as Campfire's JSON", async ({ page }) => {
    const webhook = await listenAsWebhook();
    try {
      const tag = crypto.randomUUID().slice(0, 8);
      const name = `Build Bot ${tag}`;
      const url = await openGeneralFor(page, name, webhook.url);
      await mentionBot(page, "Ship it & tell ", name, tag);
      const sent = page.getByRole("article").filter({ hasText: `Ship it & tell ${name}` });
      await expect(sent).toBeVisible();

      await expect.poll(() => webhook.received.length).toBe(1);
      const [{ method, path, headers, body }] = webhook.received as [Received];
      expect([method, path]).toEqual(["POST", "/hooks/build?team=ops"]);
      expect(headers).toMatchObject({ "content-type": "application/json", accept: "*/*", "user-agent": "Ruby" });
      expect(body).not.toMatch(/[<>&]/);
      const payload = JSON.parse(body) as { user: { name: string }; room: { name: string; path: string }; message: { id: string; body: { html: string; plain: string }; path: string } };
      // The room's address is the bot's own, as its command posts to, and the message's its permalink.
      const room = new URL(url).pathname;
      expect(payload).toMatchObject({ user: { name: ADMINISTRATOR.name }, room: { name: "general", path: room }, message: { body: { plain: "Ship it & tell" } } });
      expect(Object.keys(payload)).toEqual(["user", "room", "message"]);
      expect(payload.message.path).toBe(`${room.replace(/\/[^/]+\/messages$/, "")}/@${payload.message.id}`);
      // The stored rich text, the mention an attachment as Campfire keeps it.
      expect(payload.message.body.html).toMatch(/^<p>Ship it &amp; tell <action-text-attachment [^>]*content-type="application\/vnd\.campfire\.mention"/);
    } finally {
      await webhook.close();
    }
  });
});

test.describe(feature("bots.webhook-reply"), () => {
  test("what a bot's webhook answers, gzipped, shows in the room as the bot's message", async ({ page }) => {
    const webhook = await listenAsWebhook((response) => response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Encoding": "gzip" }).end(gzipSync("Zipped reply")));
    try {
      const tag = crypto.randomUUID().slice(0, 8);
      const name = `Build Bot ${tag}`;
      await openGeneralFor(page, name, webhook.url);
      await mentionBot(page, "Ship it ", name, tag);

      const reply = page.getByRole("article").filter({ hasText: "Zipped reply" });
      await expect(reply).toBeVisible();
      await expect(reply).toContainText(name);
      expect(webhook.received).toHaveLength(1);
    } finally {
      await webhook.close();
    }
  });

  test("a picture a bot's webhook answers shows in the room as the bot's file", async ({ page }) => {
    let chart = Buffer.alloc(0);
    const webhook = await listenAsWebhook((response) => response.writeHead(200, { "Content-Type": "image/png" }).end(chart));
    try {
      const tag = crypto.randomUUID().slice(0, 8);
      const name = `Build Bot ${tag}`;
      await openGeneralFor(page, name, webhook.url);
      chart = (await drawnPicture(page, "chart.png", 40, 20)).buffer;
      await mentionBot(page, "Chart it ", name, tag);

      // Named by its type, as Campfire names a file a webhook answers.
      const reply = page.getByRole("article").filter({ hasText: name }).filter({ has: page.getByRole("img", { name: "attachment.png" }) });
      await expect(reply).toBeVisible();
      expect(await shownPicture(reply.getByRole("img", { name: "attachment.png" }))).toEqual({ type: "image/png", width: 40, height: 20 });
    } finally {
      await webhook.close();
    }
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

test.describe(feature("bots.membership"), () => {
  test("a bot is offered to mention, to message and for a private room, but isn't among the people", async ({ page }) => {
    const tag = crypto.randomUUID().slice(0, 8);
    const name = `Build Bot ${tag}`;
    await openGeneralFor(page, name);

    // It joined general as it was added, so the composer offers it there.
    const composer = editorField(page, "Write a message");
    await composer.pressSequentially("@");
    await expect(page.getByRole("listbox")).toBeVisible();
    const listed = page.waitForResponse((response) => new URL(response.url()).searchParams.get("filter") === tag);
    await composer.pressSequentially(tag);
    await listed;
    await expect(page.getByRole("listbox").getByRole("option")).toHaveText([name]);

    await page.goto("/rooms/directs/new");
    const newDirect = page.getByRole("dialog", { name: "New direct message" });
    await newDirect.getByRole("combobox", { name: "Search people" }).fill(tag);
    await expect(newDirect.getByRole("option")).toHaveText([name]);

    await page.goto("/rooms/closeds/new");
    await expect(page.getByRole("switch", { name: `Give ${name} access to this room` })).not.toBeChecked();

    await page.goto("/account/edit");
    const people = page.getByRole("list", { name: "People" });
    await expect(people.getByRole("listitem").filter({ hasText: ADMINISTRATOR.name })).toBeVisible();
    await expect(people.getByText(name)).toHaveCount(0);
  });
});

test.describe(feature("bots.profile"), () => {
  test("a bot's page, opened from its avatar, shows that and a button that starts a DM with it, until it's deleted", async ({ page }) => {
    await openBots(page);
    const name = `Build Bot ${crypto.randomUUID().slice(0, 8)}`;
    await addBot(page, name);
    await botNamed(page, name).getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL(/\/users\/[^/]+$/);
    const profile = new URL(page.url()).pathname;
    await expect(page).toHaveTitle(name);
    await expect(page.getByRole("img", { name: "Profile avatar" })).toBeVisible();
    // Neither its name, nor a sign-in link or Ban, which the administrator gets on a person's page.
    await expect(page.getByRole("main").getByRole("heading")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: `Ban ${name}` })).toHaveCount(0);

    await page.getByRole("button", { name: `Ping ${name}` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${name}`);

    await page.goto("/account/bots");
    await botNamed(page, name).getByRole("link", { name: `Edit ${name}` }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete this chat bot" }).click();
    await expect(page).toHaveURL(/\/account\/bots$/);

    await page.goto(profile);
    await expect(page.getByText(`${name} is no longer on this account`)).toBeVisible();
    await expect(page.getByRole("img", { name: "Profile avatar" })).toBeVisible();
    await expect(page.getByRole("button", { name: `Ping ${name}` })).toHaveCount(0);
  });
});

