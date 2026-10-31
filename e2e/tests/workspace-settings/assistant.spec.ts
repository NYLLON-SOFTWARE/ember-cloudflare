import type { APIRequestContext, Page } from "@playwright/test";
import { administratorSession, cookieHeader, expect, SAME_ORIGIN, signInAsAdministrator, test, useOwnAddress } from "../../fixtures";
import { AI_GATEWAY_ACCOUNT } from "../../projects/workspace-settings";
import { HELLO, startFakeGateway, type FakeGateway } from "./fake-gateway";

// The AI assistant tab's Ember AI card and Set up Ember AI, on the second test server, which asks models
// through the AI Gateway this spec fakes. Each test leaves the workspace as a new one is: Ember AI off.

let gateway: FakeGateway;
test.beforeAll(async () => void (gateway = await startFakeGateway()));
test.afterAll(() => gateway.close());
test.afterEach(async ({ request }) => {
  const forgotten = await request.delete("/api/account/assistant", { headers: await asAdministrator(request) });
  expect(forgotten.status(), await forgotten.text()).toBe(200);
});

/** The administrator's session's headers, for the API. */
const asAdministrator = async (request: APIRequestContext) => ({ Cookie: cookieHeader(await administratorSession(request)), ...SAME_ORIGIN });

/** Opens the AI assistant tab as the administrator, answering its Ember AI card. */
async function openAssistant(page: Page) {
  await useOwnAddress(page);
  await page.goto("/account/edit#assistant-settings");
  await signInAsAdministrator(page);
  return page.getByRole("region", { name: "Ember AI", exact: true });
}

test.describe("Ember AI", () => {
  test("the administrator gives Ember an account and API token, and a model that says hello through AI Gateway", async ({ page }) => {
    const card = await openAssistant(page);
    await expect(card).toContainText("Ember AI adds @ember, an AI assistant, to every room open to everyone");
    await card.getByRole("switch", { name: "Ember AI" }).click();

    const setup = page.getByRole("dialog");
    await expect(setup).toHaveAccessibleName("Set up Ember AI");
    await expect(setup.getByRole("link", { name: "Open Workers AI in the Cloudflare dashboard" })).toHaveAttribute("href", "https://dash.cloudflare.com/?to=/:account/ai/workers-ai");
    await setup.getByRole("textbox", { name: "Account ID" }).fill(AI_GATEWAY_ACCOUNT.accountId);
    await setup.getByRole("textbox", { name: "API token" }).fill("e2e-only-not-the-accounts-token");
    await setup.getByRole("button", { name: "Continue" }).click();
    await expect(setup).toHaveAccessibleName("Choose a model");
    await expect(setup.getByRole("combobox", { name: "Model" })).toHaveValue("@cf/zai-org/glm-4.7-flash");
    await setup.getByRole("button", { name: "Save" }).click();

    // AI Gateway refuses a token it doesn't know, which comes back to its field.
    await expect(setup).toHaveAccessibleName("Set up Ember AI");
    await expect(setup.getByRole("alert")).toContainText("Cloudflare didn't take that API token for this account.");
    await setup.getByRole("textbox", { name: "API token" }).fill(AI_GATEWAY_ACCOUNT.apiToken);
    await setup.getByRole("button", { name: "Continue" }).click();
    await setup.getByRole("button", { name: "Save" }).click();
    await expect(setup).toHaveAccessibleName("Ember AI is set up");
    await expect(setup).toContainText(HELLO);
    expect(gateway.asked.at(-1)).toMatchObject({
      path: `/accounts/${AI_GATEWAY_ACCOUNT.accountId}/ai/v1/chat/completions`,
      authorization: `Bearer ${AI_GATEWAY_ACCOUNT.apiToken}`,
      gateway: "default",
      body: { model: "@cf/zai-org/glm-4.7-flash", max_completion_tokens: expect.any(Number) as unknown },
    });
    await setup.getByRole("button", { name: "Done" }).click();
    await expect(setup).toBeHidden();
    await expect(card).toContainText("@ember runs on GLM-4.7 Flash through Cloudflare AI Gateway.");
    await expect(card.getByRole("switch", { name: "Ember AI" })).toBeChecked();

    // Ember keeps it.
    await page.reload();
    await expect(page.getByRole("region", { name: "Ember AI", exact: true })).toContainText("@ember runs on GLM-4.7 Flash through Cloudflare AI Gateway.");
  });

  test("the administrator changes the model, keeping the API token, and asks Anthropic's in Messages", async ({ page, request }) => {
    const saved = await request.put("/api/account/assistant", { data: { ...AI_GATEWAY_ACCOUNT, model: "@cf/google/gemma-4-26b-a4b-it" }, headers: await asAdministrator(request) });
    expect(saved.status(), await saved.text()).toBe(200);
    const card = await openAssistant(page);
    await expect(card).toContainText("@ember runs on Gemma 4 26B through Cloudflare AI Gateway.");
    await card.getByRole("button", { name: "Change" }).click();

    const setup = page.getByRole("dialog");
    await expect(setup.getByRole("textbox", { name: "Account ID" })).toHaveValue(AI_GATEWAY_ACCOUNT.accountId);
    await expect(setup.getByRole("textbox", { name: "API token" })).toHaveValue("");
    await setup.getByRole("button", { name: "Continue" }).click();
    await setup.getByRole("combobox", { name: "Model" }).selectOption({ label: "Claude Sonnet 5.5" });
    await setup.getByRole("button", { name: "Save" }).click();
    await expect(setup).toHaveAccessibleName("Ember AI is set up");
    expect(gateway.asked.at(-1)).toMatchObject({
      path: `/accounts/${AI_GATEWAY_ACCOUNT.accountId}/ai/v1/messages`,
      authorization: `Bearer ${AI_GATEWAY_ACCOUNT.apiToken}`,
      body: { model: "anthropic/claude-sonnet-5.5", max_tokens: expect.any(Number) as unknown },
    });
    await setup.getByRole("button", { name: "Done" }).click();
    await expect(card).toContainText("@ember runs on Claude Sonnet 5.5 through Cloudflare AI Gateway.");
  });

  test("the administrator turns Ember AI off, once they're sure", async ({ page, request }) => {
    const saved = await request.put("/api/account/assistant", { data: { ...AI_GATEWAY_ACCOUNT, model: "@cf/zai-org/glm-4.7-flash" }, headers: await asAdministrator(request) });
    expect(saved.status(), await saved.text()).toBe(200);
    const card = await openAssistant(page);
    const assistantSwitch = card.getByRole("switch", { name: "Ember AI" });
    await expect(assistantSwitch).toBeChecked();
    page.once("dialog", (dialog) => void dialog.accept());
    await assistantSwitch.click();
    await expect(assistantSwitch).not.toBeChecked();
    await expect(card).toContainText("Ember AI adds @ember");

    // Turned off, Ember forgot the API token, so setting it up again needs one.
    await assistantSwitch.click();
    const setup = page.getByRole("dialog");
    await setup.getByRole("textbox", { name: "Account ID" }).fill(AI_GATEWAY_ACCOUNT.accountId);
    await expect(setup.getByRole("button", { name: "Continue" })).toBeDisabled();
  });
});
