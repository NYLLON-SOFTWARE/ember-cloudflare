import { useRef, useState } from "react";
import { MAX_PASSWORD_LENGTH, SIGN_IN_REFUSED, type Me } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AuthCard, AuthHeading, AuthPage, Problem, type SignedOutWorkspace } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { GuestSignIn } from "@/components/guest-sign-in";
import { Input } from "@/components/ui/input";
import { useTitle } from "@/hooks/use-title";
import { ApiError, signIn } from "@/lib/api";

// ember-rust's sign-in page (crates/views/templates/sessions/new.html, styled by the .mb-auth-* rules
// in zz-ember.css) and the help contact under it. A refused sign-in shakes the card and flashes
// ember-rust's alert, keeping the email address and emptying the password, as its page does when
// it's shown again.

/** Signs in with an email address and password, or with just a name when the workspace allows it. */
export function SignInPage({ workspace, onSignedIn }: { workspace: SignedOutWorkspace; onSignedIn: (me: Me) => void }) {
  const [asGuest, setAsGuest] = useState(false);
  const [emailAddress, setEmailAddress] = useState(() => new URLSearchParams(location.search).get("email_address") ?? "");
  const [busy, setBusy] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const flash = useFlash();

  useTitle("Sign in");

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onSignedIn(await signIn({ emailAddress, password: passwordInput.current?.value ?? "" }));
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      if (passwordInput.current) passwordInput.current.value = "";
      flash("alert", SIGN_IN_REFUSED);
      setShaking(true);
      passwordInput.current?.focus();
    }
  }

  return (
    <AuthPage workspace={workspace}>
      {problem && <Problem>{problem}</Problem>}
      <AuthCard onAnimationEnd={(event) => event.target === event.currentTarget && setShaking(false)} className={shaking ? "motion-safe:animate-shake" : undefined}>
        {asGuest ? (
          <GuestSignIn logo={workspace.account.logo} onSignedIn={onSignedIn} onUsePassword={() => setAsGuest(false)} />
        ) : (
          <>
            <AuthHeading title={`Sign in to ${workspace.account.name}`} logo={workspace.account.logo}>Welcome back. Pick up the conversation.</AuthHeading>
            <form
              className={AUTH_FORM}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field id="email_address" label="Email address" translation="email_address">
                <Input
                  id="email_address"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.target.value)}
                  className={FIELD_INPUT}
                />
              </Field>
              <Field id="password" label="Password" translation="password">
                {/* Uncontrolled, so what's typed never reaches its `value` attribute, where custom CSS could read it. */}
                <Input
                  ref={passwordInput}
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  className={FIELD_INPUT}
                />
              </Field>
              <SubmitButton disabled={busy}>Sign in</SubmitButton>
            </form>
            {workspace.guestSignIn && <AuthAlternative question="No account?" action="Join with just a name" onClick={() => setAsGuest(true)} disabled={busy} />}
          </>
        )}
      </AuthCard>
    </AuthPage>
  );
}
