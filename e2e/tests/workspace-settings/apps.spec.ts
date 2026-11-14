import type { APIRequestContext, Page } from "@playwright/test";
import { TOOL_GONE, type AgentTools, type AppAnswer, type Apps } from "@ember/protocol/apps";
import { administratorSession, cookieHeader, editorField, expect, SAME_ORIGIN, signInAsAdministrator, test, useOwnAddress } from "../../fixtures";
import { AI_GATEWAY_ACCOUNT } from "../../projects/workspace-settings";
import { FILE_QUESTION, FILED, startFakeGateway, type FakeGateway } from "./fake-gateway";
import { calledWith, MCP_TOKEN, SERVER_NAME, startFakeMcp, TOOLS, type FakeMcp } from "./fake-mcp";

// The Apps card on the AI assistant tab, Connect an app, a connected app's page, the Tools card on
// @ember's page, and @ember calling a picked tool once it's allowed, on the second test server, with an
// MCP server this spec fakes on this machine. Each test leaves the workspace as a new one is: no apps,
// and Ember AI off.

const SONNET = "anthropic/claude-sonnet-5.5";

let gateway: FakeGateway;
let mcp: FakeMcp;
test.beforeAll(async () => void ([gateway, mcp] = await Promise.all([startFakeGateway(), startFakeMcp()])));
test.afterAll(() => Promise.all([gateway.close(), mcp.close()]));
test.beforeEach(async ({ request }) => {
  const saved = await request.put("/api/account/assistant", { data: { ...AI_GATEWAY_ACCOUNT, model: SONNET }, headers: await asAdministrator(request) });
  expect(saved.status(), await saved.text()).toBe(200);
});
test.afterEach(async ({ request }) => {
  const headers = await asAdministrator(request);
  // Apps are removed while Ember AI is on, which keeps them while it's off.
  const listed = await request.get("/api/account/apps", { headers });
  expect(listed.status(), await listed.text()).toBe(200);
  for (const { id } of ((await listed.json()) as Apps).apps) {
    const removed = await request.delete(`/api/account/apps/${id}`, { headers });
    expect(removed.status(), await removed.text()).toBe(204);
  }
  const forgotten = await request.delete("/api/account/assistant", { headers });
  expect(forgotten.status(), await forgotten.text()).toBe(200);
});

/** The administrator's session's headers, for the API. */
const asAdministrator = async (request: APIRequestContext) => ({ Cookie: cookieHeader(await administratorSession(request)), ...SAME_ORIGIN });

/** Opens the AI assistant tab as the administrator, answering its Apps card. */
async function openApps(page: Page) {
  await useOwnAddress(page);
  await page.goto("/account/edit#assistant-settings");
  await signInAsAdministrator(page);
  return page.getByRole("region", { name: "Apps", exact: true });
}

/** Asks @ember `question` in the room the page shows. */
async function askEmber(page: Page, question: string): Promise<void> {
  const composer = editorField(page, "Write a message");
  await composer.pressSequentially("@Embe");
  await expect(page.getByRole("listbox").getByRole("option")).toHaveText(["Ember Agent"]);
  await composer.press("Tab");
  await composer.pressSequentially(question);
  await composer.press("Enter");
}

test.describe("Apps", () => {
  test("the administrator connects an app by its MCP server's address and token, reads its tools again, and removes it", async ({ page }) => {
    const card = await openApps(page);
    await expect(card).toContainText("No apps are connected yet.");
    await card.getByRole("link", { name: "Connect an app" }).click();
    await expect(page).toHaveURL(/\/account\/apps\/new$/);
    await expect(page).toHaveTitle("Connect an app");

    // Without its token, the server asks for a sign-in, which the token's field says.
    const host = new URL(mcp.url).host;
    await page.getByRole("textbox", { name: "Name" }).fill("Tracker");
    await page.getByRole("textbox", { name: "Server address" }).fill(mcp.url);
    await page.getByRole("button", { name: "Connect" }).click();
    const token = page.getByLabel("Token", { exact: true });
    await expect(token).toHaveAccessibleDescription(`${host} asks for a sign-in. Give a token for it, if it has one: Ember can't sign in to an app any other way yet.`);
    await expect(page).toHaveURL(/\/account\/apps\/new$/);

    // With it, Ember reads the server's tools and goes to the app's page, which lists them.
    await token.fill(MCP_TOKEN);
    await page.getByRole("button", { name: "Connect" }).click();
    await expect(page).toHaveURL(/\/account\/apps\/[^/]+\/edit$/);
    await expect(page.getByRole("alert")).toHaveText("Tracker is connected. Ember read 2 tools from it.");
    await expect(page).toHaveTitle("Edit app");
    const tools = page.getByRole("region", { name: /^Tools/ });
    await expect(tools.getByRole("heading", { name: "Tools (2)" })).toBeVisible();
    await expect(tools).toContainText(`Its server calls itself ${SERVER_NAME}`);
    await expect(tools).toContainText("Connected by Ada Lovelace");
    await expect(tools.getByRole("listitem")).toHaveText([/^search_issuesSearch issuesFinds issues by their words\.$/, /^create_issueOpens an issue in a project\.$/]);
    // The page never shows the token again.
    await expect(token).toHaveValue("");
    await expect(token).toHaveAccessibleDescription("It has a token. Leave this blank to keep it, or type another.");
    expect(mcp.asked.filter((method) => method === "tools/list")).toHaveLength(1);

    // The server gains a tool, which Read its tools again finds.
    mcp.tools.push({ name: "close_issue", description: "Closes an issue.", inputSchema: { type: "object" } });
    await tools.getByRole("button", { name: "Read its tools again" }).click();
    await expect(tools.getByRole("heading", { name: "Tools (3)" })).toBeVisible();
    await expect(tools.getByRole("listitem").last()).toHaveText("close_issueCloses an issue.");

    // A reload shows the app's page, and the tab lists it.
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Tracker");
    await page.getByRole("link", { name: "Go Back" }).click();
    await expect(card.getByRole("listitem")).toHaveText([`Tracker${host}/mcp · 3 toolsEdit Tracker`]);

    // Removing it asks first, then takes it off the tab.
    await card.getByRole("link", { name: "Edit Tracker" }).click();
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Remove Tracker" }).click();
    await expect(card).toContainText("No apps are connected yet.");
    await expect(card.getByRole("listitem")).toHaveCount(0);
  });

  test("the administrator renames an app, which reads nothing from its server, and an address with no MCP server is refused", async ({ page, request }) => {
    const connected = await request.post("/api/account/apps", { data: { name: "Tracker", url: mcp.url, token: MCP_TOKEN }, headers: await asAdministrator(request) });
    expect(connected.status(), await connected.text()).toBe(201);
    const card = await openApps(page);
    await card.getByRole("link", { name: "Edit Tracker" }).click();

    const asked = mcp.asked.length;
    const name = page.getByRole("textbox", { name: "Name" });
    await expect(name).toHaveValue("Tracker");
    await name.fill("Issue tracker");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(mcp.asked).toHaveLength(asked);

    // Another address is asked before it's saved, and one without a server there is refused, on its field.
    const address = page.getByRole("textbox", { name: "Server address" });
    await address.fill(mcp.url.replace(/\/mcp$/, "/nowhere"));
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(address).toHaveAccessibleDescription(`${new URL(mcp.url).host} has no MCP server at that address. Check the address, which often ends in /mcp.`);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Issue tracker");
    await expect(page.getByRole("textbox", { name: "Server address" })).toHaveValue(mcp.url);
  });

  test("the administrator picks a connected app's tools for @ember, which a reload keeps, and picks again one its server describes another way since", async ({ page, request }) => {
    mcp.tools.splice(0, mcp.tools.length, ...TOOLS.map((tool) => ({ ...tool })));
    const headers = await asAdministrator(request);
    const connected = await request.post("/api/account/apps", { data: { name: "Tracker", url: mcp.url, token: MCP_TOKEN }, headers });
    expect(connected.status(), await connected.text()).toBe(201);
    const { app } = (await connected.json()) as AppAnswer;

    await useOwnAddress(page);
    await page.goto("/account/agents/ember/edit");
    await signInAsAdministrator(page);
    const tools = page.getByRole("region", { name: "Tools", exact: true });
    await expect(tools.getByRole("group", { name: "Tracker" }).getByRole("checkbox")).toHaveCount(2);
    const search = tools.getByRole("checkbox", { name: "search_issues, Search issues" });
    const create = tools.getByRole("checkbox", { name: "create_issue" });
    await expect(search).toHaveAccessibleDescription("Finds issues by their words.");

    // A pick is saved as it's made.
    await search.check();
    await expect(tools).toContainText("1 of 20 picked");
    await create.check();
    await expect(tools).toContainText("2 of 20 picked");
    await page.reload();
    await expect(search).toBeChecked();
    await expect(create).toBeChecked();
    // Picking a tool doesn't call it.
    expect(mcp.asked).not.toContain("tools/call");

    // The server says something else of a tool, which Ember finds when it reads its tools again.
    mcp.tools[1]!.description = "Opens an issue, and emails everyone.";
    const read = await request.post(`/api/account/apps/${app.id}/tools`, { headers });
    expect(read.status(), await read.text()).toBe(200);
    // The page loaded before that, so a pick from it would be of a tool nobody has read: it's refused,
    // and the card shows the tools as they are now.
    await search.uncheck();
    await expect(tools.getByRole("alert")).toHaveText(TOOL_GONE);
    await expect(search).toBeChecked();
    await expect(create).not.toBeChecked();
    await expect(create).toHaveAccessibleDescription(/^Opens an issue, and emails everyone\..*Pick it again to keep it\.$/);
    await expect(tools).toContainText("1 of 20 picked");
    await create.check();
    await expect(tools).toContainText("2 of 20 picked");
    await expect(create).toHaveAccessibleDescription("Opens an issue, and emails everyone.");

    // Removing the app leaves @ember nothing to pick.
    const removed = await request.delete(`/api/account/apps/${app.id}`, { headers });
    expect(removed.status(), await removed.text()).toBe(204);
    await page.reload();
    await expect(tools).toContainText("No apps are connected yet.");
    await expect(tools.getByRole("checkbox")).toHaveCount(0);
  });

  test("someone asks @ember for what a picked tool does, and it runs once they allow the call on its card, and not when they deny it", async ({ page, request }) => {
    mcp.tools.splice(0, mcp.tools.length, ...TOOLS.map((tool) => ({ ...tool })));
    mcp.calls.length = 0;
    const headers = await asAdministrator(request);
    const connected = await request.post("/api/account/apps", { data: { name: "Tracker", url: mcp.url, token: MCP_TOKEN }, headers });
    expect(connected.status(), await connected.text()).toBe(201);
    const offered = (await (await request.get("/api/account/agents/ember/tools", { headers })).json()) as AgentTools;
    const tools = offered.apps.flatMap(({ id, tools }) => tools.filter(({ name }) => name === "create_issue").map(({ name, fingerprint }) => ({ appId: id, name, fingerprint })));
    const picked = await request.put("/api/account/agents/ember/tools", { data: { tools }, headers });
    expect(picked.status(), await picked.text()).toBe(200);
    // In a room of the test's own, which everyone is in, @ember too.
    const created = await request.post("/api/rooms", { data: { kind: "open", name: `Issues ${crypto.randomUUID().slice(0, 8)}` }, headers });
    expect(created.status(), await created.text()).toBe(201);
    const { room } = (await created.json()) as { room: { id: string; name: string } };
    await useOwnAddress(page);
    await page.goto(`/rooms/${room.id}`);
    await signInAsAdministrator(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(room.name);

    // Its model calls the tool, which waits on a card that says what it would be called with.
    const title = `Login fails ${crypto.randomUUID().slice(0, 8)}`;
    await askEmber(page, `${FILE_QUESTION} ${title}`);
    const card = page.getByRole("article", { name: "Ember wants to use Tracker" }).filter({ hasText: title });
    await expect(card).toContainText("create_issue, with:");
    await expect(card).toContainText(`"title": "${title}"`);
    await expect(card).toContainText("Ada Lovelace or an administrator can allow this call.");
    expect(mcp.calls).toEqual([]);

    // Allowed, it runs, with what the card showed, and the answer goes on with what the app answered.
    await card.getByRole("button", { name: "Allow once" }).click();
    await expect(card).toContainText("Allowed by Ada Lovelace.");
    await expect(card.getByRole("button", { name: "Allow once" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Deny" })).toHaveCount(0);
    await expect(page.getByRole("article").filter({ hasText: FILED })).toContainText(`${FILED} ${calledWith("create_issue", { title })}`);
    expect(mcp.calls).toEqual([{ name: "create_issue", arguments: { title } }]);
    // The model was given the tool under its app's name, and never the app's address or token.
    const said = JSON.stringify(gateway.asked.map(({ body }) => body));
    expect(said).toContain("Tracker__create_issue");
    expect(said).not.toContain(MCP_TOKEN);
    expect(said).not.toContain(new URL(mcp.url).host);

    // Denied, it isn't run, which the model is told.
    const other = `Logout fails ${crypto.randomUUID().slice(0, 8)}`;
    await askEmber(page, `${FILE_QUESTION} ${other}`);
    const denied = page.getByRole("article", { name: "Ember wants to use Tracker" }).filter({ hasText: other });
    await denied.getByRole("button", { name: "Deny" }).click();
    await expect(denied).toContainText("Not allowed by Ada Lovelace.");
    await expect(page.getByRole("article").filter({ hasText: `${FILED} Not run: the person you're answering was asked to allow this call, and didn't.` })).toBeVisible();
    expect(mcp.calls).toHaveLength(1);
  });
});
