import type { APIRequestContext, Page } from "@playwright/test";
import type { Apps } from "@ember/protocol/apps";
import { administratorSession, cookieHeader, expect, SAME_ORIGIN, signInAsAdministrator, test, useOwnAddress } from "../../fixtures";
import { AI_GATEWAY_ACCOUNT } from "../../projects/workspace-settings";
import { startFakeGateway, type FakeGateway } from "./fake-gateway";
import { MCP_TOKEN, SERVER_NAME, startFakeMcp, type FakeMcp } from "./fake-mcp";

// The Apps card on the AI assistant tab, Connect an app, and a connected app's page, on the second test
// server, with an MCP server this spec fakes on this machine. Each test leaves the workspace as a new
// one is: no apps, and Ember AI off.

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
});
