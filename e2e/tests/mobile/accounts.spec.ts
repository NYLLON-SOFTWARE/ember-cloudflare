import type { Page } from "@playwright/test";
import type { Account } from "@ember/protocol";
import { isolateRoom, openRoom, signInAs, signInAsAdministrator, useOwnAddress, WORKSPACE_SOCKET } from "../../fixtures";
import { auditScreen } from "./audits";
import { expect, hasDrawerLayout, SWITCHES, test } from "./fixtures";

/** A name as long as the server takes, with a run that only breaks anywhere. */
const LONG_NAME = "The-Analytical-Engine-Appreciation-Society-of-Greater-Marylebone-and-the-Surrounding-Districts";

/**
 * Shows `page` the workspace as `change` makes it wherever the server says what it is, its socket's
 * welcome included, without changing the test server's, which every other test shows.
 */
async function changeTheWorkspace(page: Page, change: (account: Account) => Account): Promise<void> {
  const changed = <T extends { account: Account }>(body: T): T => ({ ...body, account: change(body.account) });
  for (const path of ["**/api/bootstrap", "**/api/account"]) {
    await page.route(path, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      await route.fulfill({ response, json: changed(await response.json()) });
    });
  }
  await page.routeWebSocket(WORKSPACE_SOCKET, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      const frame = JSON.parse(String(message));
      ws.send(JSON.stringify("account" in frame ? changed(frame) : frame));
    });
  });
}

const nameTheWorkspaceLong = (page: Page) => changeTheWorkspace(page, (account) => ({ ...account, name: LONG_NAME }));
const showTranslationButtons = (page: Page) => changeTheWorkspace(page, (account) => ({ ...account, hideTranslationButtons: false }));

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
  await showTranslationButtons(page);
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

test("the welcome card's translation list, by the screen's edge, opens where it fits the phone", async ({ page, room, session, safeArea }) => {
  await showTranslationButtons(page);
  await signInAs(page, session);
  await isolateRoom(page, room, { joinCode: "aB3d-Ef5h-iJ7k" });
  await openRoom(page, room);
  await page.getByRole("main").locator("summary", { hasText: "Translate" }).tap();
  await expect(page.locator("details[open] dl")).toBeVisible();
  const results = await auditScreen(page, safeArea);
  expect.soft(results.overflow, "Nothing is cut off or pushed off the side of the screen").toEqual([]);
  expect.soft(results.safeArea, "Nothing sits under the notch, rounded corners or home indicator").toEqual([]);
});
