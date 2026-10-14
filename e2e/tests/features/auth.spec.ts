import { feature } from "@ember/parity";
import { SIGN_IN_REFUSED } from "@ember/protocol";
import type { Browser, Page } from "@playwright/test";
import { ADMINISTRATOR, invitation, signInAsAdministrator, useOwnAddress, type TestRoom } from "../../fixtures";
import { expect, test } from "./fixtures";

const signInHeading = (page: Page) => page.getByRole("heading", { level: 1, name: "Sign in to Ember" });

/** Opens `room` on a browser of the administrator's own, signing in on the way. Close its context afterwards. */
async function administratorOn(browser: Browser, baseURL: string, room: TestRoom): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await useOwnAddress(page);
  await page.goto(`/rooms/${room.id}`);
  await signInAsAdministrator(page);
  await expect(page.getByRole("log", { name: `Messages in ${room.name}` })).toBeVisible();
  return page;
}

test.describe(feature("auth.sign-in"), () => {
  test.beforeEach(({ page }) => useOwnAddress(page));

  test("signs in with an email address and password, and opens the page asked for", async ({ page, rooms }) => {
    await page.goto(`/rooms/${rooms.general.id}`);
    await expect(page).toHaveURL(/\/session\/new$/);
    await expect(page).toHaveTitle("Sign in");
    await expect(signInHeading(page)).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeFocused();

    await signInAsAdministrator(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(page).toHaveURL(new RegExp(`/rooms/${rooms.general.id}$`));
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", ADMINISTRATOR.name);
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
  });

  test("flashes an alert for a wrong password, keeping the email address", async ({ page }) => {
    await page.goto("/session/new");
    await signInAsAdministrator(page, "incorrect horse battery");
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(SIGN_IN_REFUSED);
    await expect(page.getByLabel("Email address")).toHaveValue(ADMINISTRATOR.emailAddress);
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page.getByLabel("Password")).toBeFocused();
    // The alert fades out by itself, leaving the page as it was.
    await expect(alert).toHaveCount(0);
    await expect(page).toHaveURL(/\/session\/new$/);
  });

  test("fills in the email address its link gives", async ({ page }) => {
    await page.goto(`/session/new?email_address=${encodeURIComponent(ADMINISTRATOR.emailAddress)}`);
    await expect(page.getByLabel("Email address")).toHaveValue(ADMINISTRATOR.emailAddress);
  });
});

test.describe(feature("auth.sign-up"), () => {
  test.beforeEach(({ page }) => useOwnAddress(page));

  /** Fills in the join form and sends it. */
  async function join(page: Page, emailAddress: string) {
    await page.getByLabel("Name").fill("Grace Hopper");
    await page.getByLabel("Email address").fill(emailAddress);
    await page.getByLabel("Password").fill("compiler");
    await page.getByRole("button", { name: "Create account" }).click();
  }

  test("someone new joins with the welcome card's link, signs out and signs back in", async ({ browser, baseURL, page, request, session }) => {
    const { roomId } = await invitation(request, session);
    const administrator = await administratorOn(browser, baseURL!, { id: roomId, name: "All Talk" });
    const link = await administrator.getByRole("textbox", { name: "Share to invite more people" }).inputValue();
    await administrator.context().close();

    await page.goto(link);
    await expect(page).toHaveTitle("Sign up");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Join Ember");
    await expect(page.getByLabel("Name")).toBeFocused();
    const emailAddress = `grace-${crypto.randomUUID()}@example.com`;
    await join(page, emailAddress);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Grace Hopper");

    await page.getByRole("button", { name: "Your profile" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(signInHeading(page)).toBeVisible();
    await page.getByLabel("Email address").fill(emailAddress);
    await page.getByLabel("Password").fill("compiler");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Grace Hopper");
  });

  test("sends an email address that has an account to sign in with it filled in", async ({ page, request, session }) => {
    await page.goto(`/join/${(await invitation(request, session)).joinCode}`);
    await join(page, ADMINISTRATOR.emailAddress);
    await expect(signInHeading(page)).toBeVisible();
    expect(new URL(page.url()).search).toBe("?email_address=ada%40example.com");
    await expect(page.getByLabel("Email address")).toHaveValue(ADMINISTRATOR.emailAddress);
  });

  test("answers any other code with an empty 404", async ({ page }) => {
    // Asked as the signed-out page, since a browser shows its own error page for it, as for ember-rust's.
    const response = await page.request.get("/join/AAAA-BBBB-CCCC");
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("");
  });

  test("sends someone who's signed in home", async ({ members, request }) => {
    const ada = await members.signIn("Ada");
    await ada.page.goto(`/join/${(await invitation(request, ada.session)).joinCode}`);
    await expect(ada.page.getByRole("heading", { level: 1 })).toHaveText("general");
    expect(new URL(ada.page.url()).pathname).toBe("/");
  });
});

test.describe(feature("auth.help-contact"), () => {
  test("names whom to ask for help, and the version, under the sign-in and join cards", async ({ page, request, session }) => {
    for (const path of ["/session/new", `/join/${(await invitation(request, session)).joinCode}`]) {
      await page.goto(path);
      const contact = page.getByRole("link", { name: ADMINISTRATOR.emailAddress });
      await expect(contact).toHaveAttribute("href", `mailto:"${ADMINISTRATOR.name}" <${ADMINISTRATOR.emailAddress}>`);
      await expect(contact).toHaveAttribute("title", `Email ${ADMINISTRATOR.name}`);
      await expect(page.getByText(/^Ember™ version/)).toHaveText(/^Ember™ version \d+\.\d+/);
    }
  });
});

test.describe(feature("auth.guest-sign-in"), () => {
  test("signs in with a display name and opens the first room", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Join with just a name" }).click();
    await expect(page.getByRole("heading", { name: "Welcome to Ember" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join" })).toBeDisabled();

    await page.getByLabel("Your name").fill("  Ada Lovelace  ");
    await page.getByRole("button", { name: "Join" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("general");
    await expect(page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Ada Lovelace");
    // The session's cookie is out of the page's reach, and nothing else holds it.
    expect(await page.evaluate(() => document.cookie)).not.toContain("session_token");
    expect(await page.evaluate(() => localStorage.getItem("ember:session"))).toBeNull();
  });
});

test.describe(feature("auth.sessions"), () => {
  test("stays signed in across reloads", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.page.reload();
    await ada.connected();
    await expect(ada.page.getByRole("button", { name: "Your profile" })).toHaveAttribute("title", "Ada");
  });

  test("goes back to sign-in when the session cookie is no good", async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "session_token", value: "A".repeat(43), url: baseURL! }]);
    await page.goto("/");
    await expect(signInHeading(page)).toBeVisible();
  });
});

test.describe(feature("auth.sign-out"), () => {
  test("signs out from the profile menu and stays signed out", async ({ members }) => {
    const ada = await members.signIn("Ada");
    await ada.page.getByRole("button", { name: "Your profile" }).click();
    await expect(ada.page.getByRole("menu")).toContainText("Ada");
    await ada.page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(signInHeading(ada.page)).toBeVisible();
    await expect(ada.page).toHaveURL(/\/session\/new$/);

    await ada.page.reload();
    await expect(signInHeading(ada.page)).toBeVisible();
  });

  test("sends this browser's other tabs to sign in, and leaves other devices signed in", async ({ browser, baseURL, rooms }) => {
    const laptop = await administratorOn(browser, baseURL!, rooms.general);
    const phone = await administratorOn(browser, baseURL!, rooms.general);
    try {
      const otherTab = await laptop.context().newPage();
      await otherTab.goto(`/rooms/${rooms.general.id}`);
      await expect(otherTab.getByRole("log", { name: "Messages in general" })).toBeVisible();

      await laptop.getByRole("button", { name: "Your profile" }).click();
      await laptop.getByRole("menuitem", { name: "Log out" }).click();
      await expect(signInHeading(laptop)).toBeVisible();
      // The room closed the other tab's socket, so it found out without being touched.
      await expect(signInHeading(otherTab)).toBeVisible();

      const composer = phone.getByRole("textbox", { name: /^Message #/ });
      await composer.fill("Still signed in on the phone");
      await composer.press("Enter");
      await expect(phone.getByRole("article").filter({ hasText: "Still signed in on the phone" })).toBeVisible();
      await phone.reload();
      await expect(phone.getByRole("heading", { level: 1 })).toHaveText("general");
    } finally {
      await Promise.all([laptop.context().close(), phone.context().close()]);
    }
  });
});
