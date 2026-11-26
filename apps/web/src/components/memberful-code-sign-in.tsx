import { useRef, useState } from "react";
import { MAX_EMAIL_ADDRESS_LENGTH, memberfulSignInPath, PASSWORD_RESET_CODE_DIGITS, PASSWORD_RESET_CODE_MINUTES, welcomePath, type Me } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AuthHeading } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { TURNSTILE_UNAVAILABLE } from "@/components/join-page";
import { FramedTurnstileCheck } from "@/components/turnstile-frame";
import { Input } from "@/components/ui/input";
import { ApiError, askForMemberfulCode, signInWithMemberfulCode } from "@/lib/api";
import { loadPage } from "@/lib/page";
import { returnPath, takeReturnPath } from "@/lib/return-path";

// Signing in with Memberful on the sign-in card itself, while Ember offers it (`memberfulCodes`): a member
// gives the address their Memberful account has, Ember emails it a code once Memberful finds a member
// with it, and they give the code back here, which signs them in as Memberful's own page does. Asking
// waits for Turnstile's check while Ember has a widget's keys, drawn in a frame, since the app shows the
// card without loading the page afresh, and nothing the card says tells who's a member. A refusal is said
// at the top of the form and shakes the card, as sign-in's are, and a failure on Ember's side over it.

const NO_CONNECTION = "Couldn't reach Ember. Check your connection and try again.";
const CODE_UNSENT = "Ember couldn't email you a code just now. Please try again.";
const SIGN_IN_FAILED = "Ember couldn't sign you in just now. Please try again.";

/** The answers that refuse asking or signing in, each for a reason the person can act on. */
const REFUSALS = new Set([403, 422, 429]);

/** What a failure on Ember's side says: what the Worker says of it while it can't email or reach Memberful, or else `otherwise`. */
const failureOf = (error: ApiError, otherwise: string) => (error.status === 503 ? error.message : otherwise);

/**
 * The address the card asked Ember to email a code to, which it keeps in its history entry, so that it
 * asks for the code still when the browser loads it again, as a phone's may once someone has been to
 * their email, while a new visit asks for an address afresh.
 */
export function memberfulCodeAskedOnArrival(): string | null {
  const asked: unknown = (history.state as { memberfulCodeAsked?: unknown } | null)?.memberfulCodeAsked;
  return typeof asked === "string" ? asked : null;
}

/** Keeps the address the card asked Ember to email a code to in its history entry, or forgets it for null (`memberfulCodeAskedOnArrival`). */
export const keepMemberfulCodeAsked = (emailAddress: string | null) =>
  history.replaceState({ ...(history.state as object | null), memberfulCodeAsked: emailAddress }, "");

/** What the card's two steps share with the rest of it. */
interface StepProps {
  /** Called with whether the step's form is on its way, while the card's other buttons wait for it. */
  onBusy: (busy: boolean) => void;
  /** Says what went wrong apart from the form, over the card, or forgets it for null. */
  onProblem: (problem: string | null) => void;
  /** Called once the form is refused, which shakes the card. */
  onRefused: () => void;
}

/** The form's alert, saying why it was refused, as sign-in's says it. */
function Refusal({ children }: { children: string }) {
  return (
    <p role="alert" className="rounded-[8px] border border-auth-error-border bg-auth-error-background px-3.5 py-3 text-[14px] leading-normal text-auth-error">
      {children}
    </p>
  );
}

interface CodeRequestProps extends StepProps {
  /** The Turnstile widget's site key, while Ember has one, whose check the form waits for. */
  siteKey: string | null;
  emailAddress: string;
  onChange: (emailAddress: string) => void;
  /** What happens once Ember has been asked to email a code to `emailAddress`, the address the form sent, whatever the field says by then. */
  onAsked: (emailAddress: string) => void;
}

/** The form asking Ember to email a code to the address a Memberful account has, which draws Turnstile's check afresh for each ask. */
export function MemberfulCodeRequest({ siteKey, emailAddress, onChange, onAsked, onBusy, onProblem, onRefused }: CodeRequestProps) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // The token of the check passed, which is good for one ask, and how many asks the check has been drawn for.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  function working(on: boolean) {
    setBusy(on);
    onBusy(on);
  }

  async function submit() {
    working(true);
    onProblem(null);
    setRefusal(null);
    try {
      await askForMemberfulCode(siteKey === null ? { emailAddress } : { emailAddress, turnstileToken: turnstileToken ?? "" });
      onAsked(emailAddress);
    } catch (error) {
      if (!(error instanceof ApiError)) onProblem(NO_CONNECTION);
      else if (!REFUSALS.has(error.status)) onProblem(failureOf(error, CODE_UNSENT));
      else {
        setRefusal(error.message);
        onRefused();
      }
    } finally {
      working(false);
      if (siteKey !== null) {
        setTurnstileToken(null);
        setTries((tries) => tries + 1);
      }
    }
  }

  return (
    <form
      className={AUTH_FORM}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {refusal && <Refusal>{refusal}</Refusal>}
      <Field id="email_address" label="Email address" translation="email_address">
        <Input
          id="email_address"
          type="email"
          required
          autoFocus
          autoComplete="username"
          placeholder="Enter your Memberful email address"
          maxLength={MAX_EMAIL_ADDRESS_LENGTH}
          value={emailAddress}
          onChange={(event) => onChange(event.target.value)}
          className={FIELD_INPUT}
        />
      </Field>
      {siteKey !== null && <FramedTurnstileCheck key={tries} siteKey={siteKey} onToken={setTurnstileToken} onUnavailable={() => onProblem(TURNSTILE_UNAVAILABLE)} />}
      <SubmitButton disabled={busy || (siteKey !== null && turnstileToken === null)}>Email me a code</SubmitButton>
    </form>
  );
}

interface CodeEntryProps extends StepProps {
  /** The workspace's logo, for the step's heading. */
  logo: string | null;
  /** The address Ember was asked to email a code to. */
  emailAddress: string;
  onSignedIn: (me: Me) => void;
  /** Goes back to ask for another code, at this address or another. */
  onAskAgain: () => void;
  /** Called with why, once the address is someone's here already whom the code doesn't sign in, as they never proved it theirs, so their password does. */
  onTaken: (refusal: string) => void;
}

/**
 * The step giving the code Ember emailed to `emailAddress`, which signs in as the member who has it, or
 * the person here who proved it theirs too, and someone new goes on to the welcome page, as signing in on
 * Memberful's page has them do. A code that doesn't work is said at the top of the form, keeping what was
 * typed, selected to type again.
 */
export function MemberfulCodeEntry({ logo, emailAddress, onSignedIn, onAskAgain, onTaken, onBusy, onProblem, onRefused }: CodeEntryProps) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Uncontrolled, as passwords are, so the code never reaches a `value` attribute, where custom CSS could read it.
  const codeInput = useRef<HTMLInputElement>(null);

  function working(on: boolean) {
    setBusy(on);
    onBusy(on);
  }

  async function submit() {
    working(true);
    onProblem(null);
    setRefusal(null);
    try {
      const answer = await signInWithMemberfulCode({ emailAddress, code: codeInput.current?.value ?? "" });
      keepMemberfulCodeAsked(null);
      // A new page, as Memberful's own sign-in comes back to, where someone new chooses how people here see them.
      if ("joined" in answer) return loadPage(welcomePath(takeReturnPath() ?? "/"));
      working(false);
      onSignedIn(answer.user);
    } catch (error) {
      working(false);
      if (!(error instanceof ApiError)) return onProblem(NO_CONNECTION);
      if (error.field === "password") return onTaken(error.message);
      if (!REFUSALS.has(error.status)) return onProblem(failureOf(error, SIGN_IN_FAILED));
      setRefusal(error.message);
      onRefused();
      codeInput.current?.focus();
      codeInput.current?.select();
    }
  }

  return (
    <>
      <AuthHeading title="Check your email" logo={logo}>
        If a Memberful account has {emailAddress}, Ember emailed it a code that works for {PASSWORD_RESET_CODE_MINUTES} minutes. If it hasn't arrived soon, look in your spam
        folder.
      </AuthHeading>
      <form
        className={AUTH_FORM}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {refusal && <Refusal>{refusal}</Refusal>}
        <Field id="code" label="Code">
          <Input
            ref={codeInput}
            id="code"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={`${PASSWORD_RESET_CODE_DIGITS}-digit code`}
            className={FIELD_INPUT}
          />
        </Field>
        <SubmitButton disabled={busy}>Sign in</SubmitButton>
      </form>
      <AuthAlternative question="Didn't get it?" action="Send another code" onClick={onAskAgain} disabled={busy} />
      <AuthAlternative question="Prefer Memberful's page?" action="Continue with Memberful" href={memberfulSignInPath(returnPath())} />
    </>
  );
}
