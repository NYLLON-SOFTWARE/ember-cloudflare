import {
  MEMBERFUL_CALLBACK_PATH,
  MEMBERFUL_SIGN_IN_PROBLEMS,
  MEMBERFUL_WEBHOOK_PATH,
  memberfulSignInPath,
  PASSWORD_RESET_CODE_WRONG,
  usernameFrom,
  type Account,
  type WorkspaceSettings,
} from "@ember/protocol";
import { MEMBERFUL_API_KEY_UNKNOWN, MEMBERFUL_CLIENT_UNKNOWN } from "@ember/protocol/memberful";
import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import {
  administratorSession,
  cookieHeader,
  drawnPicture,
  fakeTurnstile,
  logOut,
  SAME_ORIGIN,
  sentFrom,
  shownPicture,
  signInAsAdministrator,
  TURNSTILE_WIDGET,
  turnstileTokenFor,
  useOwnAddress,
} from "../../fixtures";
import { MEMBERFUL_KEYS, MEMBERFUL_SITE } from "../../projects/workspace-settings";
import { sendWebhook, startFakeMemberful, type FakeMember, type FakeMemberful } from "./fake-memberful";
import { forgetResendKey, giveResendKey, startFakeResend, type FakeResend } from "./fake-resend";
import { startFakeSiteverify, type FakeSiteverify } from "./fake-siteverify";

// Signing in with Memberful, at a Memberful site of the specs' own (fake-memberful.ts), whose address and
// keys the first spec gives Ember in Set up Memberful, and the others as it saves them. Each spec turns
// Memberful on, members only unless it says, and off again after, since Members only turns the join link
// off for the specs that follow. Those signing in with a code Ember emails have it send email with the
// Resend API the email specs fake (fake-resend.ts), and take its key and the From address away after.

let site: FakeMemberful;

test.beforeAll(async ({ baseURL }) => {
  site = await startFakeMemberful(baseURL!);
});

test.afterAll(() => site.close());

test.afterEach(({ request }) => turnMemberful(request, false));

/** Memberful as the administrator's settings show it. */
async function memberfulOf(request: APIRequestContext): Promise<WorkspaceSettings> {
  const administrator = await administratorSession(request);
  const response = await request.get("/api/account", { headers: { Cookie: cookieHeader(administrator) } });
  return (await response.json()) as WorkspaceSettings;
}

/** The administrator's session's headers, for the API. */
const asAdministrator = async (request: APIRequestContext) => ({ Cookie: cookieHeader(await administratorSession(request)), ...SAME_ORIGIN });

/** Gives Ember the site's address and keys, as Set up Memberful saves them, as the administrator. Giving them again changes nothing. */
async function giveKeys(request: APIRequestContext): Promise<void> {
  const administrator = await administratorSession(request);
  const keys = { site: MEMBERFUL_SITE, ...MEMBERFUL_KEYS };
  const response = await request.put("/api/account/memberful_keys", { data: keys, headers: { Cookie: cookieHeader(administrator), ...SAME_ORIGIN } });
  expect(response.status(), await response.text()).toBe(200);
}

/** Turns Memberful on, members only unless `membersOnly` is false, with the site's keys, or off, which turns Members only off too, as the administrator. */
async function turnMemberful(request: APIRequestContext, on: boolean, { membersOnly = true } = {}): Promise<void> {
  if (on) await giveKeys(request);
  const administrator = await administratorSession(request);
  const settings = on ? { memberfulJoin: true, memberfulSignIn: membersOnly } : { memberfulJoin: false };
  const response = await request.patch("/api/account", { data: { settings }, headers: { Cookie: cookieHeader(administrator), ...SAME_ORIGIN } });
  expect(response.status(), await response.text()).toBe(200);
  const { account } = (await response.json()) as { account: Account };
  expect([account.memberfulJoin, account.memberfulSignIn]).toEqual([on, on && membersOnly]);
}

/** The join link's address, which only works while Memberful isn't members only. */
async function joinPath(request: APIRequestContext): Promise<string> {
  return `/join/${(await memberfulOf(request)).joinCode}`;
}

/** Someone who joins with a password, as everyone did before Memberful was members only. */
interface Joiner {
  name: string;
  emailAddress: string;
  password: string;
}

/** Has someone new join through the join link in `page`, with a password, which signs them in there. */
async function joinWithPassword(page: Page, request: APIRequestContext, name: string): Promise<Joiner> {
  const joiner = { name, emailAddress: `${crypto.randomUUID()}@example.com`, password: "compiler error" };
  await page.goto(await joinPath(request));
  await page.getByLabel("Name", { exact: true }).fill(joiner.name);
  await page.getByLabel("Email address").fill(joiner.emailAddress);
  await page.getByLabel("Password").fill(joiner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(composer(page)).toBeVisible();
  return joiner;
}

/** Has someone new join through the join link with a password, in a browser of their own, so `request` keeps the administrator's cookie. */
async function joinedWithPassword(browser: Browser, baseURL: string, request: APIRequestContext, name: string): Promise<Joiner> {
  const joining = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  const page = await joining.newPage();
  await useOwnAddress(page);
  const joiner = await joinWithPassword(page, request, name);
  await joining.close();
  return joiner;
}

/** Signs in at the Memberful site as `member`, from the page it shows its members on. */
const signInThereAs = (page: Page, member: FakeMember) => page.getByRole("link", { name: `Sign in as ${member.fullName}` }).click();

/** Signs in with Memberful from the sign-in page `page` shows, as `member`. */
async function signInWithMemberful(page: Page, member: FakeMember): Promise<void> {
  await page.getByRole("link", { name: "Sign in with Memberful" }).click();
  await signInThereAs(page, member);
}

/** The page someone new comes to from Memberful, before the page they signed in from. */
const welcomeHeading = (page: Page) => page.getByRole("heading", { level: 1, name: /^Welcome to / });

/** Goes on from the welcome page, as someone new who keeps their photo, name and username as they are. */
async function goOnFromWelcome(page: Page): Promise<void> {
  await expect(welcomeHeading(page)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Write a message" });
const memberfulSection = (page: Page) => page.getByRole("region", { name: "Memberful" });
/** A name no earlier run of a server kept between runs has used. */
const nameFor = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

test.describe("Set up Memberful", () => {
  test("the administrator turns Memberful on, which sets it up first with the site's address and its custom app's and webhook's keys, once Memberful takes them", async ({
    page,
    request,
    baseURL,
  }) => {
    test.skip((await memberfulOf(request)).memberfulKeys !== null, "An earlier run of this server gave Ember the site's keys, so the switch turns Memberful on at once");
    await useOwnAddress(page);
    await page.goto("/account/edit#membership-settings");
    await signInAsAdministrator(page);
    const memberful = page.getByRole("switch", { name: "Memberful", exact: true });
    await memberful.click();
    const setup = page.getByRole("dialog", { name: "Set up Memberful" });
    // Ember's addresses, to give Memberful's custom app and webhook.
    await expect(setup.getByRole("listitem").nth(1)).toContainText(`${baseURL}${MEMBERFUL_CALLBACK_PATH}`);
    await expect(setup.getByRole("listitem").nth(2)).toContainText(`${baseURL}${MEMBERFUL_WEBHOOK_PATH}`);
    // A site's name alone is its address at memberful.com, where the steps link to its admin's forms for the app and the webhook.
    const address = setup.getByLabel("Address", { exact: true });
    await address.fill("fernwood");
    await expect(setup.getByRole("link", { name: "create a new app for Ember" })).toHaveAttribute("href", "https://fernwood.memberful.com/admin/settings/custom_applications/new");
    await expect(setup.getByRole("link", { name: "Settings → Webhooks → Create webhook" })).toHaveAttribute("href", "https://fernwood.memberful.com/admin/settings/webhooks/new");
    // Nothing links while what's typed can't be a site's address, though Chrome reads one with a space as a host, nor at
    // a site that isn't at memberful.com, as the specs' own isn't.
    await address.fill("fern wood");
    await expect(setup.getByRole("link")).toHaveCount(0);
    await address.fill(MEMBERFUL_SITE);
    await expect(setup.getByRole("link")).toHaveCount(0);
    await setup.getByLabel("API Key", { exact: true }).fill("not-the-apps-api-key");
    await setup.getByLabel("OAuth Identifier", { exact: true }).fill(MEMBERFUL_KEYS.clientId);
    await setup.getByLabel("OAuth Secret", { exact: true }).fill("not-the-apps-secret");
    await setup.getByLabel("Secret key", { exact: true }).fill(MEMBERFUL_KEYS.webhookSecret);
    const save = setup.getByRole("button", { name: "Save" });
    await save.click();
    // Memberful's admin API doesn't take the API key, and then its token endpoint doesn't know the app with that secret.
    await expect(setup.getByRole("alert")).toHaveText(MEMBERFUL_API_KEY_UNKNOWN);
    await setup.getByLabel("API Key", { exact: true }).fill(MEMBERFUL_KEYS.apiKey);
    await save.click();
    await expect(setup.getByRole("alert")).toHaveText(MEMBERFUL_CLIENT_UNKNOWN);
    await setup.getByLabel("OAuth Secret", { exact: true }).fill(MEMBERFUL_KEYS.clientSecret);
    await save.click();

    const done = page.getByRole("dialog", { name: "Memberful is set up" });
    await expect(done).toContainText(`members of ${MEMBERFUL_SITE} join and sign in with their Memberful account`);
    await done.getByRole("button", { name: "Done" }).click();
    await expect(memberful).toBeChecked();
    await expect(memberfulSection(page)).toContainText(`Members of ${MEMBERFUL_SITE} join and sign in with their Memberful account.`);
    await expect(memberfulSection(page).getByRole("button", { name: "Change keys" })).toBeVisible();
    // Ember keeps the secrets to itself.
    const settings = await memberfulOf(request);
    expect(settings).toMatchObject({ memberfulSite: MEMBERFUL_SITE, memberfulWebhooks: true, memberfulKeys: "saved" });
    for (const secret of [MEMBERFUL_KEYS.clientSecret, MEMBERFUL_KEYS.apiKey, MEMBERFUL_KEYS.webhookSecret]) expect(JSON.stringify(settings)).not.toContain(secret);
  });
});

test.describe("Sign in with Memberful", () => {
  test("a member of the Memberful site signs in as someone new, choosing their photo, name and username first, and as themselves from then on", async ({ page, request }) => {
    const member = site.add(nameFor("Grace"));
    await turnMemberful(request, true);
    await useOwnAddress(page);
    await page.goto("/users/me/profile");
    await signInWithMemberful(page, member);
    // Welcomed first, with the name Memberful has for them, and a username made from it.
    await expect(welcomeHeading(page)).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(member.fullName);
    await expect(page.getByLabel("Username")).toHaveValue(usernameFrom(member.fullName));
    const name = `${member.fullName} Hopper`;
    const username = `amazing.${crypto.randomUUID().slice(0, 8)}`;
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Username").fill(` @${username.toUpperCase()}`);
    await expect(page.getByLabel("Username")).toHaveValue(username);
    await page.getByLabel("Upload photo").setInputFiles(await drawnPicture(page, "portrait.png", 300, 600));
    await expect(page.getByRole("img", { name: "Your profile photo" })).toHaveAttribute("src", /^blob:/);
    await page.getByRole("button", { name: "Continue" }).click();

    // Then back on the page they were sent to sign in from, as they chose to be.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(page.getByLabel("Username")).toHaveValue(username);
    await expect(page.getByLabel("Email address")).toHaveValue(member.email);
    expect(await shownPicture(page.getByRole("img", { name: "Your avatar" }))).toEqual({ type: "image/webp", width: 256, height: 512 });
    // Their profile names the account, which is how they sign in, so it offers them no password, and nothing to disconnect.
    await expect(memberfulSection(page)).toContainText(`Connected as ${member.fullName} (${member.email}). You sign in with Memberful.`);
    await expect(page.getByLabel("New password")).toHaveCount(0);
    await expect(memberfulSection(page).getByRole("button", { name: "Disconnect Memberful" })).toHaveCount(0);

    await logOut(page);
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
    await page.goto("/users/me/profile");
    await expect(page.getByLabel("Email address")).toHaveValue(member.email);
  });

  test("beside the join link, a member of the Memberful site joins with it from under the password form, and keeps signing in with it once it's off, when nobody new can", async ({
    page,
    request,
  }) => {
    await useOwnAddress(page);
    const joiner = await joinWithPassword(page, request, nameFor("Annie"));
    const member = site.add(nameFor("Grace"));
    await turnMemberful(request, true, { membersOnly: false });
    await logOut(page);
    await expect(page.getByLabel("Email address")).toBeVisible();
    await signInWithMemberful(page, member);
    await goOnFromWelcome(page);
    await expect(composer(page)).toBeVisible();

    await turnMemberful(request, false);
    await logOut(page);
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
    await logOut(page);
    await signInWithMemberful(page, site.add(nameFor("Dorothy")));
    await expect(page.getByRole("alert")).toHaveText(MEMBERFUL_SIGN_IN_PROBLEMS.off);

    // Whoever joined with a password signs in with it as they always did.
    await page.getByLabel("Email address").fill(joiner.emailAddress);
    await page.getByLabel("Password").fill(joiner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(composer(page)).toBeVisible();
  });
});

test.describe("Sign in with a code Ember emails", () => {
  // Where Ember's email comes from, under the workspace's name.
  const FROM = "chat@acme.example";
  let resend: FakeResend;
  let siteverify: FakeSiteverify;
  test.beforeAll(async () => {
    resend = await startFakeResend();
    siteverify = await startFakeSiteverify();
  });
  test.afterAll(async () => {
    await resend.close();
    await siteverify.close();
  });
  test.afterEach(async ({ request }) => {
    await sendEmail(request, false);
    const forgotten = await request.delete("/api/account/turnstile_keys", { headers: await asAdministrator(request) });
    expect(forgotten.status(), await forgotten.text()).toBe(200);
  });

  /** Has Ember send email, with the Resend API's key and a From address, as Set up email does, or stop, as a new workspace hasn't either. */
  async function sendEmail(request: APIRequestContext, on: boolean): Promise<void> {
    if (on) await giveResendKey(request);
    const response = await request.patch("/api/account", { data: { emailFrom: on ? FROM : null }, headers: await asAdministrator(request) });
    expect(response.status(), await response.text()).toBe(200);
    if (!on) await forgetResendKey(request);
  }

  /** Asks for a code with the address the sign-in card's field holds, answering the code Ember emailed to `emailAddress`. */
  async function askForCode(page: Page, emailAddress: string): Promise<string> {
    const sent = resend.sent.length;
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");
    await expect.poll(() => resend.sent.length).toBe(sent + 1);
    const email = resend.sent.at(-1)!;
    expect(email).toEqual(expect.objectContaining({ from: await sentFrom(page.request, FROM), to: [emailAddress], subject: expect.stringMatching(/^Sign in to /) as unknown }));
    return /Your code: ([0-9]{8})/.exec(email.text)![1]!;
  }

  /** Signs in with `code` on the card's step that asks for it. */
  async function signInWithCode(page: Page, code: string): Promise<void> {
    await page.getByRole("textbox", { name: "Code" }).fill(code);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }

  test("a member of the Memberful site signs in on the sign-in page with a code Ember emails them, as someone new first, and as themselves from then on", async ({
    page,
    request,
  }) => {
    const member = site.add(nameFor("Ada"));
    await turnMemberful(request, true);
    await sendEmail(request, true);
    await useOwnAddress(page);
    await page.goto("/");
    // Members only, the card asks for the address their Memberful account has, with Memberful's own page under it, which comes back here too.
    await expect(page.getByRole("link", { name: "Continue with Memberful" })).toHaveAttribute("href", memberfulSignInPath("/"));
    await page.getByLabel("Email address").fill(member.email);
    const code = await askForCode(page, member.email);

    // The step asks for the code still once the page loads again, as a phone's may after a trip to the email.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");
    await expect(page.getByText(`If a Memberful account has ${member.email}, Ember emailed it a code`)).toBeVisible();
    await signInWithCode(page, code === "00000000" ? "11111111" : "00000000");
    await expect(page.getByRole("alert")).toHaveText(PASSWORD_RESET_CODE_WRONG);
    await signInWithCode(page, code);
    // Welcomed first, with the name Memberful has for them, as signing in on Memberful's page does.
    await expect(welcomeHeading(page)).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(member.fullName);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(composer(page)).toBeVisible();

    await logOut(page);
    // The profile has an email address field too, so the sign-in page is waited for.
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
    await page.getByLabel("Email address").fill(member.email);
    await signInWithCode(page, await askForCode(page, member.email));
    await expect(composer(page)).toBeVisible();
  });

  test("while Turnstile checks that people are people, the card waits for its check, which it draws in a frame, before Ember emails a code", async ({ page, request }) => {
    const member = site.add(nameFor("Edith"));
    await turnMemberful(request, true);
    await sendEmail(request, true);
    const saved = await request.put("/api/account/turnstile_keys", {
      data: { ...TURNSTILE_WIDGET, turnstileToken: turnstileTokenFor(TURNSTILE_WIDGET.siteKey) },
      headers: await asAdministrator(request),
    });
    expect(saved.status(), await saved.text()).toBe(200);
    await useOwnAddress(page);
    await fakeTurnstile(page);
    await page.goto("/");
    await page.getByLabel("Email address").fill(member.email);
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeDisabled();
    await page.frameLocator("iframe[title=\"Turnstile's check\"]").getByRole("button", { name: "Verify you are human" }).click();
    const code = await askForCode(page, member.email);
    expect(siteverify.asked.at(-1)).toMatchObject({ secret: TURNSTILE_WIDGET.secretKey, response: turnstileTokenFor(TURNSTILE_WIDGET.siteKey) });
    await signInWithCode(page, code);
    await goOnFromWelcome(page);
    await expect(composer(page)).toBeVisible();
  });

  test("a member whose Memberful email address is someone's here already is sent to sign in with that someone's password, which connects Memberful", async ({
    page,
    browser,
    baseURL,
    request,
  }) => {
    const joiner = await joinedWithPassword(browser, baseURL!, request, nameFor("Mary"));
    site.add(joiner.name, joiner.emailAddress);
    await turnMemberful(request, true);
    await sendEmail(request, true);
    await useOwnAddress(page);
    await page.goto("/");
    await page.getByLabel("Email address").fill(joiner.emailAddress);
    await signInWithCode(page, await askForCode(page, joiner.emailAddress));
    await expect(page.getByRole("alert")).toHaveText(MEMBERFUL_SIGN_IN_PROBLEMS.taken);
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);
    await page.getByLabel("Password").fill(joiner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("This workspace now uses Memberful. Connect your Memberful account to keep signing in.")).toBeVisible();
  });
});

test.describe("Ways to join", () => {
  test("the administrator turns Memberful on beside the join link, then makes it members only once they confirm, which turns the join link off", async ({ page, request }) => {
    await giveKeys(request);
    await useOwnAddress(page);
    await page.goto("/account/edit#membership-settings");
    await signInAsAdministrator(page);
    const memberful = page.getByRole("switch", { name: "Memberful", exact: true });
    await memberful.click();
    await expect(memberful).toBeChecked();
    const link = page.getByRole("switch", { name: "Join link" });
    await expect(link).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Share to invite more people" })).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    const membersOnly = page.getByRole("switch", { name: "Members only", exact: true });
    await membersOnly.click();
    await expect(membersOnly).toBeChecked();
    await expect(link).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Share to invite more people" })).toHaveCount(0);

    // Turning Memberful off takes Members only with it.
    await memberful.click();
    await expect(membersOnly).toHaveCount(0);
    await expect(link).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Share to invite more people" })).toBeVisible();
  });
});

test.describe("Memberful memberships", () => {
  test("a member whose membership lapses is signed out, and signs in again once it's renewed", async ({ page, request }) => {
    const member = site.add(nameFor("Katherine"));
    await turnMemberful(request, true);
    await useOwnAddress(page);
    await page.goto("/");
    await signInWithMemberful(page, member);
    await goOnFromWelcome(page);
    await expect(composer(page)).toBeVisible();

    // Memberful's webhook says it changed, and the Workspace asks Memberful's admin API, which says it lapsed.
    member.active = false;
    await sendWebhook(request, member);
    await expect(page.getByRole("link", { name: "Sign in with Memberful" })).toBeVisible();
    await signInWithMemberful(page, member);
    await expect(page.getByRole("alert")).toHaveText(MEMBERFUL_SIGN_IN_PROBLEMS.membership);

    member.active = true;
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
  });
});

test.describe("Connect Memberful", () => {
  test("someone with an account from before connects their Memberful account from their profile, and signs in with it from then on", async ({ page, request }) => {
    await useOwnAddress(page);
    const joiner = await joinWithPassword(page, request, nameFor("Dorothy"));
    const member = site.add(joiner.name);
    await turnMemberful(request, true);

    await page.goto("/users/me/profile");
    const section = memberfulSection(page);
    await expect(section).toContainText("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    await section.getByLabel("Password").fill(joiner.password);
    await section.getByRole("button", { name: "Connect Memberful" }).click();
    await signInThereAs(page, member);
    await expect(page.getByRole("alert")).toHaveText("Your Memberful account is connected.");
    await expect(section).toContainText(`Connected as ${member.fullName} (${member.email}). You sign in with Memberful.`);
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/users/me/profile");

    // Signing in with Memberful is signing in as themselves, with the account they had.
    await logOut(page);
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
    await page.goto("/users/me/profile");
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);

    // Disconnecting it, with their password, leaves them signed in here and offers to connect one again.
    await section.getByLabel("Password").fill(joiner.password);
    await section.getByRole("button", { name: "Disconnect Memberful" }).click();
    await expect(page.getByRole("alert")).toHaveText("Your Memberful account is disconnected.");
    await expect(section).toContainText("Members sign in with Memberful. Connect your Memberful account to keep signing in.");
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);
  });

  test("a member with an account from before connects Memberful as they sign in with their password", async ({ page, browser, baseURL, request }) => {
    const joiner = await joinedWithPassword(browser, baseURL!, request, nameFor("Mary"));
    // Memberful has their email address too, which never matches them to an account here.
    const member = site.add(joiner.name, joiner.emailAddress);
    await turnMemberful(request, true);

    await useOwnAddress(page);
    await page.goto("/users/me/profile");
    await signInWithMemberful(page, member);
    await expect(page.getByRole("alert")).toHaveText(MEMBERFUL_SIGN_IN_PROBLEMS.taken);
    await page.getByLabel("Email address").fill(joiner.emailAddress);
    await page.getByLabel("Password").fill(joiner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("This workspace now uses Memberful. Connect your Memberful account to keep signing in.")).toBeVisible();
    await page.getByRole("link", { name: "Connect Memberful" }).click();
    await signInThereAs(page, member);

    // Signed in as themselves, on the page they were sent to sign in from.
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);
    await expect(memberfulSection(page)).toContainText(`Connected as ${member.fullName} (${joiner.emailAddress}). You sign in with Memberful.`);
  });
});
