import { useRef, useState } from "react";
import { MAX_PASSWORD_LENGTH, SIGN_IN_REFUSED, type User } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AUTH_INPUT, AuthCard, AuthHeading, AuthPage, Field, Problem, SubmitButton, useTitle, type SignedOutWorkspace } from "@/components/auth-page";
import { Flash } from "@/components/flash";
import { GuestSignIn } from "@/components/guest-sign-in";
import { Input } from "@/components/ui/input";
import { ApiError, signIn } from "@/lib/api";

// ember-rust's sign-in page (crates/views/templates/sessions/new.html, styled by the .mb-auth-* rules
// in zz-ember.css) and the help contact under it. A refused sign-in shakes the card and flashes
// ember-rust's alert, keeping the email address and emptying the password, as its page does when
// it's shown again.

/** Signs in with an email address and password, or with just a name when the workspace allows it. */
export function SignInPage({ workspace, onSignedIn }: { workspace: SignedOutWorkspace; onSignedIn: (me: User) => void }) {
  const [asGuest, setAsGuest] = useState(false);
  const [emailAddress, setEmailAddress] = useState(() => new URLSearchParams(location.search).get("email_address") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const [flashing, setFlashing] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useTitle("Sign in");

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onSignedIn(await signIn({ emailAddress, password }));
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      setPassword("");
      setRefusals((count) => count + 1);
      setFlashing(true);
      setShaking(true);
      passwordInput.current?.focus();
    }
  }

  return (
    <AuthPage workspace={workspace}>
      {flashing && (
        <Flash key={refusals} onDone={() => setFlashing(false)}>
          {SIGN_IN_REFUSED}
        </Flash>
      )}
      {problem && <Problem>{problem}</Problem>}
      <AuthCard onAnimationEnd={(event) => event.target === event.currentTarget && setShaking(false)} className={shaking ? "motion-safe:animate-shake" : undefined}>
        {asGuest ? (
          <GuestSignIn onSignedIn={onSignedIn} onUsePassword={() => setAsGuest(false)} />
        ) : (
          <>
            <AuthHeading title={`Sign in to ${workspace.account.name}`}>Welcome back. Pick up the conversation.</AuthHeading>
            <form
              className={AUTH_FORM}
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field id="email_address" label="Email address">
                <Input
                  id="email_address"
                  type="email"
                  required
                  autoFocus
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.target.value)}
                  className={AUTH_INPUT}
                />
              </Field>
              <Field id="password" label="Password">
                <Input
                  ref={passwordInput}
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  maxLength={MAX_PASSWORD_LENGTH}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={AUTH_INPUT}
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
