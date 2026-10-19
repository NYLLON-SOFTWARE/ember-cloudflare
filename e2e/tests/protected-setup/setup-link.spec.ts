import { feature } from "@ember/parity";
import type { Bootstrap } from "@ember/protocol";
import { expect, test, type Page } from "@playwright/test";
import { PROTECTED_SETUP_TOKEN } from "../../projects/protected-setup";

const expectLocked = async (page: Page) => {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Setup is locked");
  await expect(page.getByText("Open it in this browser. It unlocks setup here for a day.")).toBeVisible();
};

test.describe(feature("auth.protected-setup"), () => {
  test("setup stays locked until this browser opens the private link", async ({ page, browser, baseURL, request }) => {
    const { setup } = (await (await request.get("/api/bootstrap")).json()) as Bootstrap;
    test.skip(setup === "complete", "The test server was set up by an earlier run, which reuseExistingServer kept");

    await page.goto("/");
    await expect(page).toHaveURL(/\/first_run$/);
    await expectLocked(page);
    // The address the token goes on the end of, which is this deployment's.
    await expect(page.getByText(`${baseURL}/first_run/access#token=`, { exact: true })).toBeVisible();

    await page.goto(`/first_run/access#token=${"f".repeat(64)}`);
    await expect(page.getByRole("status")).toHaveText("This setup link is unavailable. Request the current link from the server administrator.");
    expect(new URL(page.url()).hash).toBe("");

    // From the access page itself, a link that differs only in its fragment wouldn't load it again.
    await page.goto("about:blank");
    await page.goto(`/first_run/access#token=${PROTECTED_SETUP_TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set up Ember");
    expect(new URL(page.url()).pathname).toBe("/first_run");
    // The token never stays in the address, and the cookie holds none of it.
    expect(page.url()).not.toContain(PROTECTED_SETUP_TOKEN);
    const [cookie] = await page.context().cookies();
    expect(cookie).toMatchObject({ name: "__Host-ember_setup", httpOnly: true, secure: true, sameSite: "Strict" });
    expect(cookie!.value).not.toContain(PROTECTED_SETUP_TOKEN);

    // Another browser is still locked out.
    const elsewhere = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const other = await elsewhere.newPage();
    await other.goto("/first_run");
    await expectLocked(other);
    await elsewhere.close();

    await page.getByLabel("Name").fill("Ada Lovelace");
    await page.getByLabel("Email address").fill("ada@example.com");
    await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    expect(await page.context().cookies()).toEqual([expect.objectContaining({ name: "__Host-session_token" })]);

    // Once it's set up, the link only goes home.
    await page.goto(`/first_run/access#token=${PROTECTED_SETUP_TOKEN}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
  });
});
