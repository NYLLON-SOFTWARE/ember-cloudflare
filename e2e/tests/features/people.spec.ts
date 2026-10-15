import { feature } from "@ember/parity";
import type { Bootstrap, ProfileChanges } from "@ember/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { ADMINISTRATOR, cookieHeader, signInAsAdministrator, useOwnAddress, type Session } from "../../fixtures";
import { expect, test, unique } from "./fixtures";

/** Changes `session`'s person's profile through the API, as their profile page does. */
async function changeProfile(request: APIRequestContext, session: Session, changes: ProfileChanges): Promise<void> {
  const response = await request.patch("/api/users/me/profile", { data: changes, headers: { Cookie: cookieHeader(session) } });
  expect(response.status(), await response.text()).toBe(200);
}

/** The page's heading, someone's name. */
const heading = (page: Page) => page.getByRole("main").getByRole("heading", { level: 1 });

test.describe(feature("users.show"), () => {
  test("shows someone's page at its address, titled with their name, and starts a DM with them there, whose composer takes focus", async ({ members, request }) => {
    const ada = await members.signIn(unique("Ada"));
    const grace = await members.signIn(unique("Grace"));
    await changeProfile(request, grace.session, { bio: "Wrote the first compiler", emailAddress: `grace-${crypto.randomUUID()}@example.com` });

    const { page } = ada;
    await page.goto(`/users/${grace.session.user.id}`);
    await expect(heading(page)).toHaveText(grace.name);
    await expect(page).toHaveTitle(grace.name);
    await expect(page.getByRole("main").getByText("Wrote the first compiler")).toBeVisible();
    await expect(page.getByRole("img", { name: "Profile avatar" })).toBeVisible();
    // Only administrators are told someone's email address, and only your own page has the pencil.
    await expect(page.getByRole("main").getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Edit my profile" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/");

    await page.getByRole("button", { name: `Ping ${grace.name}` }).click();
    // The DM's name heads its top bar.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Direct message with ${grace.name}`);
    await ada.connected();
    await expect(ada.composer()).toBeFocused();
  });

  test("shows administrators someone's email address, and their own page a pencil to their profile", async ({ members, page, request }) => {
    const grace = await members.signIn(unique("Grace"));
    const emailAddress = `grace-${crypto.randomUUID()}@example.com`;
    await changeProfile(request, grace.session, { emailAddress });

    await useOwnAddress(page);
    await page.goto(`/users/${grace.session.user.id}`);
    await signInAsAdministrator(page);
    await expect(heading(page)).toHaveText(grace.name);
    await expect(page.getByRole("link", { name: emailAddress })).toHaveAttribute("href", `mailto:${emailAddress}`);
    await expect(page.getByRole("link", { name: "Edit my profile" })).toHaveCount(0);

    const { user } = (await (await page.request.get("/api/bootstrap")).json()) as Bootstrap;
    await page.goto(`/users/${user!.id}`);
    await expect(heading(page)).toHaveText(ADMINISTRATOR.name);
    await expect(page.getByRole("link", { name: ADMINISTRATOR.emailAddress })).toHaveAttribute("href", `mailto:${ADMINISTRATOR.emailAddress}`);
    await page.getByRole("link", { name: "Edit my profile" }).click();
    await expect(page).toHaveURL(/\/users\/me\/profile$/);
    await expect(page.getByLabel("Email address")).toHaveValue(ADMINISTRATOR.emailAddress);
  });

  test("answers Campfire's 404 page for the page of someone nobody is", async ({ members }) => {
    const { page } = await members.signIn(unique("Ada"));
    const response = await page.goto("/users/nobody");
    expect(response!.status()).toBe(404);
    await expect(page).toHaveTitle("We can’t find that (404)");
  });
});
