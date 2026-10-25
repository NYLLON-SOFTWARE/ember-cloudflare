import { useState, type FormEvent } from "react";
import { CANT_SEND_EMAIL, EMAIL_FROM_REFUSED, mailboxOf, mailboxText, type Account, type EmailProvider, type EmailSettings as Email } from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, changeAccount, isSignedOut, sendTestEmail } from "@/lib/api";
import { cn } from "@/lib/utils";

// This port's own Email card in Membership (`platform.email`), for administrators: what the deployment
// sends email with, the From address, which Save keeps, and Send me a test email, which says where it
// went, or why it wasn't sent. Until there's a From address, it says how to set sending up, with
// Cloudflare Email Service or Resend. Laid out as the Memberful card is.

/** Where the Cloudflare dashboard onboards a domain to Email Sending. */
export const EMAIL_SENDING_DASHBOARD = "https://dash.cloudflare.com/?to=/:account/email-service/sending";
/** Where Resend verifies a domain to send from. */
const RESEND_DOMAINS = "https://resend.com/domains";

/** The card's buttons, as Custom domain's are. */
const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-[9px] border bg-background px-3.5 py-2.5 font-medium disabled:opacity-50";
const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** What the card says the deployment sends email with. */
const SENDS_WITH: Record<EmailProvider, string> = {
  cloudflare: "Ember sends email with Cloudflare Email Service.",
  resend: "Ember sends email with Resend, with the API key in RESEND_API_KEY.",
};

/** What came of Send me a test email: sending, sent to an address, or refused with why. */
type TestEmail = "sending" | { to: string } | { refusal: string };

interface Props {
  email: Email;
  /** As workspace settings asks for the workspace, which it says the server answers with. */
  askForAccount: () => (account: Account) => void;
  /** Called with the From address, as it's kept, once it's saved. */
  onFromSaved: (from: string | null) => void;
  /** Says why saving or sending failed, when it isn't the provider's or the setup's doing, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** The From address `text` gives, as it's kept, null for none, as blank is, or undefined when it can't be one. */
function fromTyped(text: string): string | null | undefined {
  if (text.trim() === "") return null;
  const mailbox = mailboxOf(text);
  return mailbox ? mailboxText(mailbox) : undefined;
}

/** How Ember sends email, for administrators: what with, the From address, a test email, and until there's a From address, how to set it up. */
export function EmailSettings({ email, askForAccount, onFromSaved, onFailed }: Props) {
  // What's typed in From, or null while it's as saved.
  const [typed, setTyped] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [test, setTest] = useState<TestEmail | null>(null);
  const mounted = useMounted();
  const from = typed ?? email.from ?? "";
  const unsaved = typed !== null && fromTyped(typed) !== email.from;

  const save = (event: FormEvent) => {
    event.preventDefault();
    const emailFrom = fromTyped(from);
    setRefusal(emailFrom === undefined ? EMAIL_FROM_REFUSED : null);
    if (emailFrom === undefined) return;
    setSaving(true);
    const answered = askForAccount();
    changeAccount({ emailFrom }).then(
      (account) => {
        answered(account);
        if (!mounted.current) return;
        setSaving(false);
        // Unless it's been typed over since.
        setTyped((typed) => (typed === from ? null : typed));
        // What a test email came to was for the address before, but one still sending stays until it's answered.
        setTest((test) => (test === "sending" ? test : null));
        onFromSaved(emailFrom);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  const sendTest = () => {
    setTest("sending");
    sendTestEmail().then(
      (to) => {
        if (mounted.current) setTest({ to });
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        // The provider's refusal, or what setting up has left to do, which the card says itself.
        if (error instanceof ApiError && [422, 502, 503].includes(error.status)) return setTest({ refusal: error.message });
        setTest(null);
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby="email-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div>
        <h2 id="email-heading" className="text-base font-semibold">
          Email
        </h2>
        <p className={NOTE}>{email.provider === null ? CANT_SEND_EMAIL : SENDS_WITH[email.provider]}</p>
      </div>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-[16em]">
          <Field id="email_from" label="From">
            <Input
              id="email_from"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Ember <ember@example.com>"
              value={from}
              aria-invalid={refusal !== null}
              aria-describedby={refusal === null ? "email-from-description" : "email-from-refusal"}
              onChange={(event) => {
                setTyped(event.target.value);
                setRefusal(null);
              }}
              className={FIELD_INPUT}
            />
          </Field>
        </div>
        <button type="submit" disabled={saving} className={BUTTON}>
          Save
        </button>
      </form>
      {refusal !== null ? (
        <p id="email-from-refusal" role="alert" className={cn(NOTE, "text-negative")}>
          {refusal}
        </p>
      ) : (
        <p id="email-from-description" className={NOTE}>
          The address Ember's email comes from, with a name before it if you like, on a domain {email.provider === "resend" ? "verified in Resend" : "onboarded to Email Sending"}.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={sendTest} disabled={email.provider === null || email.from === null || unsaved || test === "sending"} className={BUTTON}>
          Send me a test email
        </button>
        <p role="status" className={cn("min-w-0 flex-1 basis-[16em] wrap-anywhere", test !== null && test !== "sending" && ("to" in test ? "text-positive" : "text-negative"))}>
          {test === "sending"
            ? "Sending a test email…"
            : test !== null && ("to" in test ? `Sent to ${test.to}. If it isn't in your inbox, look in spam.` : test.refusal)}
        </p>
      </div>
      {email.from === null && <Steps provider={email.provider} />}
    </section>
  );
}

/** The steps to have Ember send email: Cloudflare's, unless the deployment sends with Resend, then giving the From address. */
function Steps({ provider }: { provider: EmailProvider | null }) {
  if (provider === "resend")
    return (
      <ol aria-label="Steps to send email with Resend" className="flex list-decimal flex-col gap-2 ps-5">
        <li>
          In Resend, add the domain to send from under <em>Domains</em>, and add the DNS records it asks for until it's verified.{" "}
          <a href={RESEND_DOMAINS} target="_blank" rel="noopener" className="underline">
            Open Resend's domains
          </a>
        </li>
        <li>Give a From address on that domain above, save it, and send yourself a test email.</li>
      </ol>
    );
  return (
    <>
      <ol aria-label="Steps to send email with Cloudflare" className="flex list-decimal flex-col gap-2 ps-5">
        <li>
          Put the Cloudflare account that runs Ember on the <em>Workers Paid</em> plan. On Workers Free, Cloudflare sends only to the account's own verified
          addresses.
        </li>
        <li>
          In the Cloudflare dashboard, open <em>Email Service</em>, <em>Email Sending</em>, choose <em>Onboard Domain</em>, and pick a domain on Cloudflare
          DNS. Cloudflare adds the records sending takes.{" "}
          <a href={EMAIL_SENDING_DASHBOARD} target="_blank" rel="noopener" className="underline">
            Open Email Sending in the Cloudflare dashboard
          </a>
        </li>
        <li>Give a From address on that domain above, save it, and send yourself a test email.</li>
      </ol>
      <p className={NOTE}>
        Or send with Resend, which works on Workers Free: verify the domain in Resend, then give this Worker a Resend API key as the secret{" "}
        <code>RESEND_API_KEY</code>.
      </p>
    </>
  );
}
