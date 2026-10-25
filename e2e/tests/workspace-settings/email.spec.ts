import { feature } from "@ember/parity";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "../../fixtures";
import { ADMINISTRATOR, administratorSession, cookieHeader, SAME_ORIGIN, signInAsAdministrator, useOwnAddress } from "../../fixtures";
import { startFakeResend, type FakeResend } from "./fake-resend";

// Membership's Email card, on the second test server, which sends email with the Resend API this spec
// fakes. Each test leaves the workspace with no From address, as a new one has.

let resend: FakeResend;
test.beforeAll(async () => void (resend = await startFakeResend()));
test.afterAll(() => resend.close());
test.afterEach(({ request }) => giveFrom(request, null));

/** Gives the workspace the From address `emailFrom`, as the administrator. */
async function giveFrom(request: APIRequestContext, emailFrom: string | null): Promise<void> {
  const administrator = await administratorSession(request);
  const response = await request.patch("/api/account", { data: { emailFrom }, headers: { Cookie: cookieHeader(administrator), ...SAME_ORIGIN } });
  expect(response.status(), await response.text()).toBe(200);
}

/** Opens Membership as the administrator, answering its Email card. */
async function openEmail(page: Page) {
  await useOwnAddress(page);
  await page.goto("/account/edit#membership-settings");
  await signInAsAdministrator(page);
  return page.getByRole("region", { name: "Email" });
}

test.describe(feature("platform.email"), () => {
  test("the administrator gives Ember a From address and sends themselves a test email from it", async ({ page, baseURL }) => {
    const email = await openEmail(page);
    await expect(email).toContainText("Ember sends email with Resend, with the API key in RESEND_API_KEY.");
    await expect(email.getByRole("list", { name: "Steps to send email with Resend" })).toBeVisible();
    const sendTest = email.getByRole("button", { name: "Send me a test email" });
    await expect(sendTest).toBeDisabled();

    const from = email.getByRole("textbox", { name: "From" });
    await from.fill("Acme, Inc. <chat@acme.example>");
    await email.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("alert")).toHaveText("Changes saved.");
    await expect(from).toHaveValue('"Acme, Inc." <chat@acme.example>');
    await expect(email.getByRole("list")).toBeHidden();

    const sent = resend.sent.length;
    await sendTest.click();
    await expect(email.getByRole("status")).toHaveText(`Sent to ${ADMINISTRATOR.emailAddress}. If it isn't in your inbox, look in spam.`);
    expect(resend.sent.slice(sent)).toEqual([
      expect.objectContaining({ from: '"Acme, Inc." <chat@acme.example>', to: [ADMINISTRATOR.emailAddress], subject: expect.stringMatching(/^Test email from /) as unknown }),
    ]);
    expect(resend.sent.at(-1)!.text).toContain(`, at ${baseURL}.\n\nIt reached you, so Ember can send email.`);
    expect(resend.sent.at(-1)!.html).toContain(`<a href="${baseURL}">${baseURL}</a>`);

    // Membership shows the From address as it was kept.
    await page.reload();
    await expect(page.getByRole("region", { name: "Email" }).getByRole("textbox", { name: "From" })).toHaveValue('"Acme, Inc." <chat@acme.example>');
  });

  test("the card refuses a From address that isn't one, and says why Resend refused a test email", async ({ page, request }) => {
    const email = await openEmail(page);
    const from = email.getByRole("textbox", { name: "From" });
    await from.fill("Acme");
    await email.getByRole("button", { name: "Save" }).click();
    await expect(email.getByRole("alert")).toHaveText("From must be an email address, such as ember@example.com, or a name and one, such as Ember <ember@example.com>");

    await giveFrom(request, "chat@acme.example");
    await page.reload();
    resend.refuseNext({ status: 403, name: "validation_error", message: "The acme.example domain is not verified. Please, add and verify your domain on https://resend.com/domains" });
    const sent = resend.sent.length;
    await page.getByRole("region", { name: "Email" }).getByRole("button", { name: "Send me a test email" }).click();
    await expect(page.getByRole("region", { name: "Email" }).getByRole("status")).toHaveText(
      "Resend refused it: The acme.example domain is not verified. Please, add and verify your domain on https://resend.com/domains",
    );
    expect(resend.sent).toHaveLength(sent);
  });
});
