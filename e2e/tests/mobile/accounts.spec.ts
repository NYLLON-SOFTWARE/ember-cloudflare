import type { Page } from "@playwright/test";
import type { Account } from "@ember/protocol";
import { signInAs, signInAsAdministrator, useOwnAddress, WORKSPACE_SOCKET } from "../../fixtures";
import { auditScreen } from "./audits";
import { expect, hasDrawerLayout, SWITCHES, test } from "./fixtures";

/** A name as long as the server takes, with a run that only breaks anywhere. */
const LONG_NAME = "The-Analytical-Engine-Appreciation-Society-of-Greater-Marylebone-and-the-Surrounding-Districts";

/** `body`, whose workspace has the long name. */
const longNamed = <T extends { account: Account }>(body: T): T => ({ ...body, account: { ...body.account, name: LONG_NAME } });

/**
 * Gives `page` the long name wherever the server names the workspace, its socket's welcome included,
 * without renaming the test server's, which every other test shows.
 */
async function nameTheWorkspaceLong(page: Page): Promise<void> {
  for (const path of ["**/api/bootstrap", "**/api/account"]) {
    await page.route(path, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      await route.fulfill({ response, json: longNamed(await response.json()) });
    });
  }
  await page.routeWebSocket(WORKSPACE_SOCKET, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      ws.send(JSON.stringify("account" in frame ? longNamed(frame) : frame));
    });
  });
}

test("an administrator's workspace settings, with a long name, fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await nameTheWorkspaceLong(page);
  await page.goto("/account/edit");
  await signInAsAdministrator(page);
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(LONG_NAME);
  await screenIsFine({ denseTargets: [SWITCHES] });

  // The conversations under it, where the name wraps.
  if (hasDrawerLayout(page)) await page.getByRole("button", { name: "Open conversations" }).tap();
  await expect(page.getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine({ denseTargets: [SWITCHES] });
});

test("a member's workspace settings, with a long name, fit the phone", async ({ page, session, screenIsFine }) => {
  await nameTheWorkspaceLong(page);
  await signInAs(page, session);
  await page.goto("/account/edit");
  await expect(page.getByRole("main").getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine();
});

test("the Custom CSS page fits the phone, its field too big for iOS to zoom in on", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await page.goto("/account/custom_styles/edit");
  await signInAsAdministrator(page);
  await expect(page.getByRole("textbox", { name: "Custom CSS" })).toBeEnabled();
  await screenIsFine();
});

test("translation buttons, and the list each opens, fit the phone", async ({ page, safeArea, screenIsFine }) => {
  // Shown on this page alone, rather than for every other test the server serves.
  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { account: Account };
    await route.fulfill({ response, json: { ...body, account: { ...body.account, hideTranslationButtons: false } } });
  });
  await page.goto("/session/new");
  const globe = page.locator("summary", { hasText: "Translate" }).first();
  await expect(globe).toBeVisible();
  await screenIsFine();

  await globe.tap();
  await expect(page.locator("details[open] dl")).toBeVisible();
  // What the list covers takes no tap until it closes, as under any menu, so only how it fits counts.
  const results = await auditScreen(page, safeArea);
  expect.soft(results.overflow, "Nothing is cut off or pushed off the side of the screen").toEqual([]);
  expect.soft(results.safeArea, "Nothing sits under the notch, rounded corners or home indicator").toEqual([]);
});
