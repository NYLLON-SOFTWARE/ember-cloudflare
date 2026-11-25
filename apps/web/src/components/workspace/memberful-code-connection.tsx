import { Fragment, useRef, useState, type FormEvent } from "react";
import { MAX_EMAIL_ADDRESS_LENGTH, PASSWORD_RESET_CODE_DIGITS, PASSWORD_RESET_CODE_MINUTES, type ProfileAnswer } from "@ember/protocol";
import { ALTERNATIVE_ACTION } from "@/components/auth-alternative";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, askForMemberfulConnectionCode, connectMemberfulWithCode, isSignedOut } from "@/lib/api";
import { openPage } from "@/lib/page";
import { ConnectionPassword, connectionHelp } from "./external-connection";

// Connect Memberful on your profile with a code Ember emails, while it offers one (`MemberfulStatus.codes`),
// as the sign-in page signs members in with one: with your password, while you have one, as connecting on
// Memberful's page takes it, Ember emails the address your Memberful account has, your own unless you give
// another, a code once Memberful finds a member with it, and the code connects that account to yours,
// keeping the page. Memberful's page stays the other way to connect, as it is on the sign-in page.

interface Props {
  /** Whether you have a password, which asking for a code, or connecting on Memberful's page, takes then. */
  hasPassword: boolean;
  /** Whether you need Memberful to sign in, as the form's help says. */
  membershipNeeded: boolean;
  /** Your email address, which the form offers as the one your Memberful account has. */
  emailAddress: string;
  /** Starts connecting on Memberful's page, with your password while you have one, answering where to sign in there. */
  connectThere: (currentPassword?: string) => Promise<string>;
  /** Shows your profile as connecting answered it. */
  onConnected: (answer: ProfileAnswer) => void;
  /** Says why asking, connecting, or starting on Memberful's page didn't work, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** A muted line under the section's form offering another way, as the sign-in card's do (`AuthAlternative`), which waits while a form is on its way. */
function Alternative({ question, action, onClick, disabled }: { question: string; action: string; onClick: () => void; disabled: boolean }) {
  return (
    <p className="text-[13px] text-muted-foreground">
      {question}{" "}
      <button type="button" onClick={onClick} disabled={disabled} className={`${ALTERNATIVE_ACTION} disabled:cursor-not-allowed disabled:opacity-50`}>
        {action}
      </button>
    </p>
  );
}

/**
 * Connect Memberful with a code: the form asking Ember to email one to the address your Memberful account
 * has, then the one taking the code, which leaves a code that doesn't work selected to type again, and
 * from which Didn't get it? goes back to send another.
 */
export function MemberfulCodeConnection({ hasPassword, membershipNeeded, emailAddress: yours, connectThere, onConnected, onFailed }: Props) {
  const [emailAddress, setEmailAddress] = useState(yours);
  /** The address Ember was asked to email a code to, while the section asks for the code. */
  const [asked, setAsked] = useState<string | null>(null);
  /** Whether the first form is back from the second, when it takes the focus the second had. */
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const passwordInput = useRef<HTMLInputElement>(null);
  // Uncontrolled, as the sign-in page's is, so the code never reaches a `value` attribute, where custom CSS could read it.
  const codeInput = useRef<HTMLInputElement>(null);
  const mounted = useMounted();

  /** Says why a form didn't work, ready for another try, with the password field emptied, as Connect's is, unless you've gone to another page meanwhile. */
  const failed = (error: unknown) => {
    if (!mounted.current && !isSignedOut(error)) return;
    setBusy(false);
    if (passwordInput.current) passwordInput.current.value = "";
    onFailed(error);
  };

  const askForCode = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const address = emailAddress.trim();
    const currentPassword = passwordInput.current?.value ?? "";
    askForMemberfulConnectionCode(hasPassword ? { currentPassword, emailAddress: address } : { emailAddress: address }).then(() => {
      if (!mounted.current) return;
      setBusy(false);
      setAsked(address);
    }, failed);
  };

  const connectWithCode = (event: FormEvent) => {
    event.preventDefault();
    if (busy || asked === null) return;
    setBusy(true);
    connectMemberfulWithCode({ emailAddress: asked, code: codeInput.current?.value ?? "" }).then(
      (answer) => {
        if (!mounted.current) return;
        setBusy(false);
        onConnected(answer);
      },
      (error: unknown) => {
        failed(error);
        // A code that doesn't work is selected, to type again.
        if (mounted.current && error instanceof ApiError && error.status === 422) {
          codeInput.current?.focus();
          codeInput.current?.select();
        }
      },
    );
  };

  const connectOnMemberfulsPage = () => {
    // With your password, while you have one, which the browser asks for while the field is empty.
    if (busy || (passwordInput.current && !passwordInput.current.reportValidity())) return;
    setBusy(true);
    connectThere(hasPassword ? (passwordInput.current?.value ?? "") : undefined).then((page) => {
      // Unless you've gone to another page meanwhile, where the browser stays.
      if (mounted.current) openPage(page);
    }, failed);
  };

  const sendAnother = () => {
    setAsked(null);
    setAgain(true);
  };

  // Each step's fields are its own, so the code field is never the address field it takes the place of.
  if (asked !== null) {
    return (
      <Fragment key="code">
        <form onSubmit={connectWithCode} className={AUTH_FORM}>
          <p id="memberful-code-help">
            If a Memberful account has {asked}, Ember emailed it a code that works for {PASSWORD_RESET_CODE_MINUTES} minutes. If it hasn't arrived soon, look in your spam
            folder.
          </p>
          <Field id="memberful_code" label="Code">
            <Input
              ref={codeInput}
              id="memberful_code"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={`${PASSWORD_RESET_CODE_DIGITS}-digit code`}
              aria-describedby="memberful-code-help"
              className={FIELD_INPUT}
            />
          </Field>
          <SubmitButton disabled={busy}>Connect Memberful</SubmitButton>
        </form>
        <Alternative question="Didn't get it?" action="Send another code" onClick={sendAnother} disabled={busy} />
      </Fragment>
    );
  }
  return (
    <Fragment key="address">
      <form onSubmit={askForCode} className={AUTH_FORM}>
        <p id="memberful-connection-help">{connectionHelp("Memberful", membershipNeeded)}</p>
        <Field id="memberful_email_address" label="Memberful email address">
          <Input
            id="memberful_email_address"
            type="email"
            required
            autoFocus={again}
            autoComplete="email"
            placeholder="Enter your Memberful email address"
            maxLength={MAX_EMAIL_ADDRESS_LENGTH}
            value={emailAddress}
            onChange={(event) => setEmailAddress(event.target.value)}
            className={FIELD_INPUT}
          />
        </Field>
        {hasPassword && <ConnectionPassword ref={passwordInput} id="memberful" helpId="memberful-connection-help" />}
        <SubmitButton disabled={busy}>Email me a code</SubmitButton>
      </form>
      <Alternative question="Prefer Memberful's page?" action="Connect there" onClick={connectOnMemberfulsPage} disabled={busy} />
    </Fragment>
  );
}
