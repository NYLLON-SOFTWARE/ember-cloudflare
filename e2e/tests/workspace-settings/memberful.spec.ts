import { feature } from "@ember/parity";
import { MEMBERFUL_SIGN_IN_PROBLEMS, type Account, type WorkspaceSettings } from "@ember/protocol";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { administratorSession, cookieHeader, logOut, SAME_ORIGIN, useOwnAddress } from "../../fixtures";
import { sendWebhook, startFakeMemberful, type FakeMember, type FakeMemberful } from "./fake-memberful";

// Signing in with Memberful, at a Memberful site of the specs' own (fake-memberful.ts), whose address
// the second test server's MEMBERFUL_URL names, with its keys. Each spec turns Members sign in with
// Memberful on, and off again after, since it turns the join link off for the specs that follow.

let site: FakeMemberful;

test.beforeAll(async ({ baseURL }) => {
  site = await startFakeMemberful(baseURL!);
});

test.afterAll(() => site.close());

test.afterEach(({ request }) => turnMemberfulSignIn(request, false));

/** Turns Members sign in with Memberful on or off, as the administrator. */
async function turnMemberfulSignIn(request: APIRequestContext, on: boolean): Promise<void> {
  const administrator = await administratorSession(request);
  const response = await request.patch("/api/account", { data: { settings: { memberfulSignIn: on } }, headers: { Cookie: cookieHeader(administrator), ...SAME_ORIGIN } });
  expect(response.status(), await response.text()).toBe(200);
  expect(((await response.json()) as { account: Account }).account.memberfulSignIn).toBe(on);
}

/** The join link's address, which only works while members don't sign in with Memberful. */
async function joinPath(request: APIRequestContext): Promise<string> {
  const administrator = await administratorSession(request);
  const response = await request.get("/api/account", { headers: { Cookie: cookieHeader(administrator) } });
  return `/join/${((await response.json()) as WorkspaceSettings).joinCode}`;
}

/** Someone who joins with a password, as everyone did before members signed in with Memberful. */
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

/** Signs in at the Memberful site as `member`, from the page it shows its members on. */
const signInThereAs = (page: Page, member: FakeMember) => page.getByRole("link", { name: `Sign in as ${member.fullName}` }).click();

/** Signs in with Memberful from the sign-in page `page` shows, as `member`. */
async function signInWithMemberful(page: Page, member: FakeMember): Promise<void> {
  await page.getByRole("link", { name: "Sign in with Memberful" }).click();
  await signInThereAs(page, member);
}

const composer = (page: Page) => page.getByRole("textbox", { name: "Write a message" });
const memberfulSection = (page: Page) => page.getByRole("region", { name: "Memberful" });
/** A name no earlier run of a server kept between runs has used. */
const nameFor = (name: string) => `${name} ${crypto.randomUUID().slice(0, 8)}`;

test.describe(feature("auth.memberful-sign-in"), () => {
  test("a member of the Memberful site signs in as someone new, and as themselves from then on", async ({ page, request }) => {
    const member = site.add(nameFor("Grace"));
    await turnMemberfulSignIn(request, true);
    await useOwnAddress(page);
    await page.goto("/users/me/profile");
    await signInWithMemberful(page, member);
    // Back on the page they were sent to sign in from.
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(member.fullName);
    await expect(page.getByLabel("Email address")).toHaveValue(member.email);
    await expect(memberfulSection(page)).toContainText("Your Memberful account is connected, so you sign in with it.");

    await logOut(page);
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
    await page.goto("/users/me/profile");
    await expect(page.getByLabel("Email address")).toHaveValue(member.email);
  });
});

test.describe(feature("auth.memberful-memberships"), () => {
  test("a member whose membership lapses is signed out, and signs in again once it's renewed", async ({ page, request }) => {
    const member = site.add(nameFor("Katherine"));
    await turnMemberfulSignIn(request, true);
    await useOwnAddress(page);
    await page.goto("/");
    await signInWithMemberful(page, member);
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

test.describe(feature("auth.memberful-connect"), () => {
  test("someone with an account from before connects their Memberful account from their profile, and signs in with it from then on", async ({ page, request }) => {
    await useOwnAddress(page);
    const joiner = await joinWithPassword(page, request, nameFor("Dorothy"));
    const member = site.add(joiner.name);
    await turnMemberfulSignIn(request, true);

    await page.goto("/users/me/profile");
    const section = memberfulSection(page);
    await expect(section).toContainText("Members sign in with Memberful. Connect your Memberful account to keep signing in as yourself.");
    await section.getByLabel("Password").fill(joiner.password);
    await section.getByRole("button", { name: "Connect Memberful" }).click();
    await signInThereAs(page, member);
    await expect(page.getByRole("alert")).toHaveText("Your Memberful account is connected.");
    await expect(section).toContainText("Your Memberful account is connected, so you sign in with it.");
    expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/users/me/profile");

    // Signing in with Memberful is signing in as themselves, with the account they had.
    await logOut(page);
    await signInWithMemberful(page, member);
    await expect(composer(page)).toBeVisible();
    await page.goto("/users/me/profile");
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);
  });

  test("a member with an account from before connects Memberful as they sign in with their password", async ({ page, browser, baseURL, request }) => {
    const joining = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
    const joinPage = await joining.newPage();
    await useOwnAddress(joinPage);
    const joiner = await joinWithPassword(joinPage, request, nameFor("Mary"));
    await joining.close();
    // Memberful has their email address too, which never matches them to an account here.
    const member = site.add(joiner.name, joiner.emailAddress);
    await turnMemberfulSignIn(request, true);

    await useOwnAddress(page);
    await page.goto("/users/me/profile");
    await signInWithMemberful(page, member);
    await expect(page.getByRole("alert")).toHaveText(MEMBERFUL_SIGN_IN_PROBLEMS.taken);
    await page.getByLabel("Email address").fill(joiner.emailAddress);
    await page.getByLabel("Password").fill(joiner.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Members sign in with Memberful now. Connect your Memberful account to keep signing in as yourself.")).toBeVisible();
    await page.getByRole("link", { name: "Connect Memberful" }).click();
    await signInThereAs(page, member);

    // Signed in as themselves, on the page they were sent to sign in from.
    await expect(page.getByLabel("Email address")).toHaveValue(joiner.emailAddress);
    await expect(memberfulSection(page)).toContainText("Your Memberful account is connected, so you sign in with it.");
  });
});
