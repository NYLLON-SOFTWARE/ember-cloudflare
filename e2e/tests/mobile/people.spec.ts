import type { Page } from "@playwright/test";
import { cookieHeader, createSession, signInAs, signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { expect, hasPhoneLayout, test } from "./fixtures";

/** A name as long as the server takes, with a run that only breaks anywhere. */
const LONG_NAME = "Augusta-Ada-King-Noel-Countess-of-Lovelace-Byron";
/** A bio as long as the server takes, all one run, as a pasted link is. */
const LONG_BIO = `https://example.com/${"analytical-engine-".repeat(10)}`.padEnd(200, "x");

// Asking for the test's room makes it the only one in the sidebar, which wider phones show beside the page.
test.beforeEach(async ({ page, session, room: _ }) => {
  await signInAs(page, session);
});

test("someone's page, with a long name and bio, fits the phone with its DM button easy to tap", async ({ page, request, screenIsFine }) => {
  const person = await createSession(request, LONG_NAME);
  const response = await request.patch("/api/users/me/profile", { data: { bio: LONG_BIO }, headers: { Cookie: cookieHeader(person) } });
  expect(response.status(), await response.text()).toBe(200);

  await page.goto(`/users/${person.user.id}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(LONG_NAME);
  // A phone's is Slack's Message tile.
  await expect(page.getByRole("button", { name: "Message" })).toBeVisible();
  await screenIsFine();
});

test("your own page fits the phone with the pencil to your profile in the top bar", async ({ page, session, screenIsFine }) => {
  await page.goto(`/users/${session.user.id}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(session.user.name);
  await expect(page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Edit my profile" })).toBeVisible();
  await screenIsFine();
});

test("an administrator's view of someone's page fits the phone, down to their sign-in link and Ban", async ({ page, request, screenIsFine }) => {
  const person = await createSession(request, LONG_NAME);
  await useOwnAddress(page);
  await page.goto("/session/new");
  await signInAsAdministrator(page);
  await expect(page).not.toHaveURL(/\/session\/new$/);

  await page.goto(`/users/${person.user.id}`);
  if (hasPhoneLayout(page)) return await adminActionsInMore(page, screenIsFine);
  const link = page.getByRole("textbox", { name: "Share to get them back into their account" });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeInViewport();
  await screenIsFine();
  const ban = page.getByRole("button", { name: `Ban ${LONG_NAME}` });
  await ban.scrollIntoViewIfNeeded();
  await expect(ban).toBeInViewport();
  await screenIsFine();
});

/**
 * A phone keeps an administrator's sign-in link and Ban out of the page, in More: the link in a sheet of
 * its own, and Ban in red, which asks first in a dialog titled with what it does.
 */
async function adminActionsInMore(page: Page, screenIsFine: () => Promise<void>) {
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveText(LONG_NAME);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /ban/i })).toHaveCount(0);
  await screenIsFine();

  const moreButton = page.getByRole("button", { name: "More actions" });
  const more = page.getByRole("dialog", { name: "More actions" });
  await moreButton.tap();
  await expect(more.getByRole("button", { name: "Ban" })).toBeInViewport();
  await screenIsFine();

  await more.getByRole("button", { name: "Auto-login link" }).tap();
  const signIn = page.getByRole("dialog", { name: "Auto-login link" });
  await expect(signIn.getByRole("textbox", { name: "Share to get them back into their account" })).toBeInViewport();
  await screenIsFine();
  await page.keyboard.press("Escape");
  await expect(signIn).toBeHidden();

  await moreButton.tap();
  await more.getByRole("button", { name: "Ban" }).tap();
  const ban = page.getByRole("alertdialog", { name: `Ban ${LONG_NAME}` });
  await expect(ban.getByRole("button", { name: "Ban" })).toBeInViewport();
  await screenIsFine();
  // Banning them would block the address every test signs in from, so this stops at the question.
  await ban.getByRole("button", { name: "Cancel" }).tap();
  await expect(ban).toBeHidden();
}
