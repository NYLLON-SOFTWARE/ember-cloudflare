import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAX_PASSWORD_LENGTH, SIGN_IN_REFUSED, type Bootstrap, type User } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { Flash } from "@/components/flash";
import { GuestSignIn } from "@/components/guest-sign-in";
import { HelpContact } from "@/components/help-contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, signIn } from "@/lib/api";
import { cn } from "@/lib/utils";

// ember-rust's sign-in page (crates/views/templates/sessions/new.html, styled by the .mb-auth-* rules
// in zz-ember.css) and the help contact under it. A refused sign-in shakes the card and flashes
// ember-rust's alert, keeping the email address and emptying the password, as its page does when
// it's shown again.

const TITLE = "Sign in";
/** Campfire's `.input` with ember-rust's `.mb-field > .input`: 16px text, so phones don't zoom in. */
const INPUT =
  "h-auto min-h-[42px] touch:min-h-11 rounded-[9px] border-border bg-background px-[11px] py-[9px] text-base md:text-base shadow-none focus:border-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-foreground";

type Workspace = Omit<Bootstrap, "user">;

/** Signs in with an email address and password, or with just a name when the workspace allows it. */
export function SignInPage({ workspace, onSignedIn }: { workspace: Workspace; onSignedIn: (me: User) => void }) {
  const [asGuest, setAsGuest] = useState(false);
  const [emailAddress, setEmailAddress] = useState(() => new URLSearchParams(location.search).get("email_address") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusals, setRefusals] = useState(0);
  const [flashing, setFlashing] = useState(false);
  const [shaking, setShaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const title = document.title;
    document.title = TITLE;
    return () => void (document.title = title);
  }, []);

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
    <main className="min-h-dvh bg-surface pt-header pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] max-md:pt-[calc(56px+env(safe-area-inset-top))]">
      {flashing && (
        <Flash key={refusals} onDone={() => setFlashing(false)}>
          {SIGN_IN_REFUSED}
        </Flash>
      )}
      {problem && (
        <div role="alert" aria-atomic="true" className="mx-auto mt-6 w-[440px] max-w-[calc(100%-32px)] rounded-lg border bg-card px-4 py-3.5 max-md:max-w-[calc(100%-24px)]">
          {problem}
        </div>
      )}
      <section
        onAnimationEnd={(event) => event.target === event.currentTarget && setShaking(false)}
        className={cn(
          "mx-auto mt-[clamp(24px,7vh,88px)] mb-6 w-[440px] max-w-[calc(100%-32px)] rounded-2xl border bg-background p-8 text-start max-md:my-[18px] max-md:max-w-[calc(100%-24px)] max-md:rounded-xl max-md:px-5 max-md:py-6",
          shaking && "motion-safe:animate-shake",
        )}
      >
        {asGuest ? (
          <GuestSignIn onSignedIn={onSignedIn} onUsePassword={() => setAsGuest(false)} />
        ) : (
          <>
            <header className="mb-7 text-center">
              <img src="/ember-icon.png" alt="Ember" width={48} height={48} className="mx-auto mb-5 block size-12 object-contain" />
              <h1 className="mb-2 text-2xl leading-tight font-[650]">Sign in to {workspace.account.name}</h1>
              <p className="text-muted-foreground">Welcome back. Pick up the conversation.</p>
            </header>
            <form
              className="flex flex-col gap-5"
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
                  className={INPUT}
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
                  className={INPUT}
                />
              </Field>
              <Button type="submit" disabled={busy} className="h-auto min-h-[42px] w-full rounded-[9px] border border-primary px-4 py-2.5 text-sm font-[550] touch:min-h-11">
                Sign in
              </Button>
            </form>
            {workspace.guestSignIn && <AuthAlternative question="No account?" action="Join with just a name" onClick={() => setAsGuest(true)} disabled={busy} />}
          </>
        )}
      </section>
      <HelpContact contact={workspace.helpContact} version={workspace.version} />
    </main>
  );
}

/** ember-rust's `.mb-field`: a 13px label over its input. */
function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[7px] text-start">
      <label htmlFor={id} className="text-[13px] font-[550]">
        {label}
      </label>
      {children}
    </div>
  );
}
