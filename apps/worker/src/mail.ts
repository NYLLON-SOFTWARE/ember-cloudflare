import { CANT_SEND_EMAIL, mailboxText, type EmailProvider, type Mailbox } from "@ember/protocol";
import type { Env } from "./env";
import { isLoopback } from "./loopback";

// How Ember sends email (`platform.email`): with Resend's API while the deployment has the secret
// `RESEND_API_KEY`, or else with Cloudflare Email Service's `send_email` binding, `EMAIL`
// (https://developers.cloudflare.com/email-service/api/send-emails/workers-api/). Each email goes to one
// address, as plain text with a simple HTML version and no tracking, from the address an administrator
// gave in Membership. What a provider refuses is said in words an administrator can act on, and logged
// by its code alone, never by the address. Resend's API key never follows a redirect elsewhere.

/** Where Resend's API takes an email (https://resend.com/docs/api-reference/emails/send-email). */
const RESEND_API = "https://api.resend.com";
/** How long a provider has to take an email. */
const SEND_TIMEOUT_MS = 10_000;
/** How much of what Resend says about an email it refused is passed on. */
const MAX_REFUSAL_LENGTH = 300;

/** An email Ember sends: to one address, with its subject, and its body as plain text and as HTML. */
export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** What the deployment sends email with, or null while it can't send any. */
export function emailProviderOf(env: Env): EmailProvider | null {
  if (env.RESEND_API_KEY?.trim()) return "resend";
  return env.EMAIL ? "cloudflare" : null;
}

/** Sends `email` from `from`, answering null once the provider has taken it, or else why it wasn't sent. */
export async function sendEmail(env: Env, from: Mailbox, email: Email): Promise<string | null> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) return askResend(apiKey, resendApiOf(env), "/emails", resendEmail(from, email), 1);
  if (env.EMAIL) return sendWithCloudflare(env.EMAIL, from, email);
  return CANT_SEND_EMAIL;
}

/**
 * Sends each of `emails` from `from`, answering for each, in order, null once the provider has taken it,
 * or else why it wasn't sent. Resend takes them in one request, which it takes or refuses whole
 * (https://resend.com/docs/api-reference/emails/send-batch-emails), so that sending many never passes
 * its limit on requests a second, nor Workers Free's on requests out; Cloudflare's binding takes them
 * one at a time.
 */
export async function sendEmails(env: Env, from: Mailbox, emails: Email[]): Promise<Array<string | null>> {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (emails.length === 0) return [];
  if (apiKey) {
    const refusal = await askResend(apiKey, resendApiOf(env), "/emails/batch", emails.map((email) => resendEmail(from, email)), emails.length);
    return emails.map(() => refusal);
  }
  const binding = env.EMAIL;
  if (!binding) return emails.map(() => CANT_SEND_EMAIL);
  const refusals: Array<string | null> = [];
  for (const email of emails) refusals.push(await sendWithCloudflare(binding, from, email));
  return refusals;
}

/** Where Resend's API is: the browser tests' stand-in, which `RESEND_API_URL` names at a loopback address, or Resend's own. */
function resendApiOf(env: Env): string {
  const standIn = URL.parse(env.RESEND_API_URL?.trim() ?? "");
  return standIn && isLoopback(standIn) ? standIn.origin : RESEND_API;
}

/** What Cloudflare Email Service's error codes mean, in words an administrator can act on. */
const CLOUDFLARE_REFUSALS: Partial<Record<string, string>> = {
  E_SENDER_DOMAIN_NOT_AVAILABLE:
    "The From address's domain isn't onboarded to Cloudflare Email Service. In the Cloudflare dashboard, open Email Service, Email Sending, and choose Onboard Domain.",
  E_SENDER_NOT_VERIFIED: "Cloudflare hasn't verified the From address's domain yet. Its page under Email Service, Email Sending in the Cloudflare dashboard says what's left.",
  E_RECIPIENT_NOT_ALLOWED: "Cloudflare won't send to that address from this account. On the Workers Free plan it sends only to the account's own verified addresses.",
  E_RECIPIENT_SUPPRESSED: "Cloudflare won't send to that address, since email to it bounced or was marked as spam before.",
  E_ACCOUNT_SUSPENDED: "Cloudflare has paused sending for this account. Email Service in the Cloudflare dashboard says why.",
  E_RATE_LIMIT_EXCEEDED: "Cloudflare is taking too many emails at once. Try again in a moment.",
  E_DAILY_LIMIT_EXCEEDED: "This account has used up its sending quota with Cloudflare for today. The quota grows with good sending.",
  E_DELIVERY_FAILED: "The receiving mail server refused it.",
  E_INTERNAL_SERVER_ERROR: "Cloudflare Email Service isn't answering as it should. Try again later.",
};

async function sendWithCloudflare(binding: SendEmail, from: Mailbox, { to, subject, text, html }: Email): Promise<string | null> {
  try {
    await binding.send({ from: from.name === null ? from.address : { name: from.name, email: from.address }, to, subject, text, html });
    return null;
  } catch (error) {
    const code = codeOf(error);
    console.error("Cloudflare Email Service didn't send an email:", code ?? (error instanceof Error ? error.name : "unknown error"));
    return (code && CLOUDFLARE_REFUSALS[code]) ?? `Cloudflare Email Service didn't send it${code ? ` (${code})` : ""}.`;
  }
}

/** The code Cloudflare Email Service's binding throws an error with, such as E_SENDER_NOT_VERIFIED, or null. */
function codeOf(error: unknown): string | null {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && /^E_[A-Z_]{1,64}$/.test(code) ? code : null;
}

/** `email`, from `from`, as Resend's API takes it. */
const resendEmail = (from: Mailbox, { to, subject, text, html }: Email) => ({ from: mailboxText(from), to: [to], subject, text, html });

/** Asks Resend's API at `path` to send `count` emails, the body, answering null once it has taken them, or else why it hasn't. */
async function askResend(apiKey: string, api: string, path: string, body: unknown, count: number): Promise<string | null> {
  const emails = count === 1 ? "an email" : `${count} emails`;
  try {
    const answer = await fetch(`${api}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (answer.ok) return null;
    const { name, message } = refusalOf(await answer.json().catch(() => null));
    console.error(`Resend didn't send ${emails}:`, answer.status, name ?? "unreadable answer");
    return resendRefusal(answer.status, name, message);
  } catch (error) {
    console.error(`Sending ${emails} with Resend failed:`, error instanceof Error ? error.name : "unknown error");
    return "Resend didn't answer. Try again later.";
  }
}

/** The name and message of the error Resend answers with, where it has them. */
function refusalOf(body: unknown): { name: string | null; message: string | null } {
  const { name, message } = typeof body === "object" && body !== null ? (body as { name?: unknown; message?: unknown }) : {};
  return { name: typeof name === "string" ? name : null, message: typeof message === "string" && message.trim() ? message.trim().slice(0, MAX_REFUSAL_LENGTH) : null };
}

/** What Resend refusing an email with `status`, and the error `name` and `message`, means for an administrator (https://resend.com/docs/api-reference/errors). */
function resendRefusal(status: number, name: string | null, message: string | null): string {
  if (status === 401 || name === "missing_api_key" || name === "restricted_api_key" || name === "suspended_api_key")
    return "Resend doesn't take the API key in RESEND_API_KEY. Check it under API Keys in Resend, or make one that can send.";
  if (name === "daily_quota_exceeded") return "Resend's daily sending quota is used up. It starts again at midnight UTC.";
  if (name === "monthly_quota_exceeded") return "Resend's monthly sending quota is used up.";
  if (status === 429) return "Resend is taking too many emails at once. Try again in a moment.";
  if (status >= 500) return "Resend isn't answering as it should. Try again later.";
  return message ? `Resend refused it: ${message}` : `Resend refused it (${status}).`;
}
