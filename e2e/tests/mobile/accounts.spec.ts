import type { Page } from "@playwright/test";
import { signInAs, signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { expect, hasDrawerLayout, test } from "./fixtures";

/** A name as long as the server takes, with a run that only breaks anywhere. */
const LONG_NAME = "The-Analytical-Engine-Appreciation-Society-of-Greater-Marylebone-and-the-Surrounding-Districts";

/**
 * Gives `page` the long name wherever the server names the workspace, without renaming the test
 * server's, which every other test shows.
 */
async function nameTheWorkspaceLong(page: Page): Promise<void> {
  for (const path of ["**/api/bootstrap", "**/api/account"]) {
    await page.route(path, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      await route.fulfill({ response, json: { ...(await response.json()), account: { name: LONG_NAME } } });
    });
  }
}

test("an administrator's workspace settings, with a long name, fit the phone", async ({ page, screenIsFine }) => {
  await useOwnAddress(page);
  await nameTheWorkspaceLong(page);
  await page.goto("/account/edit");
  await signInAsAdministrator(page);
  await expect(page.getByRole("textbox", { name: "Workspace name" })).toHaveValue(LONG_NAME);
  await screenIsFine();

  // The conversations under it, where the name wraps.
  if (hasDrawerLayout(page)) await page.getByRole("button", { name: "Open conversations" }).tap();
  await expect(page.getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine();
});

test("a member's workspace settings, with a long name, fit the phone", async ({ page, session, screenIsFine }) => {
  await nameTheWorkspaceLong(page);
  await signInAs(page, session);
  await page.goto("/account/edit");
  await expect(page.getByRole("main").getByRole("heading", { level: 2, name: LONG_NAME })).toBeVisible();
  await screenIsFine();
});
