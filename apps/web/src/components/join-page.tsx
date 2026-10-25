import { useRef, useState } from "react";
import { MAX_EMAIL_ADDRESS_LENGTH, MAX_PASSWORD_LENGTH, MAX_USER_NAME_LENGTH, MIN_PASSWORD_LENGTH, type Me } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AuthCard, AuthHeading, AuthPage, Problem, type SignedOutWorkspace } from "@/components/auth-page";
import avatarPlaceholder from "@/components/avatar-placeholder.svg";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Camera } from "@/components/icons/iconoir";
import { TurnstileCheck } from "@/components/turnstile-check";
import { Input } from "@/components/ui/input";
import { useChosenPhoto, type PhotoChoice } from "@/hooks/use-chosen-photo";
import { useTitle } from "@/hooks/use-title";
import { ApiError, joinWorkspace, signUp } from "@/lib/api";
import { loadPage } from "@/lib/page";

// ember-rust's join page (crates/views/templates/users/new.html), which the workspace's join link
// opens for someone signed out. Without a code it's open sign-up's page, this port's own
// (`auth.open-sign-up`), which shows Turnstile's check while the deployment has its keys.

/** What the page says when Turnstile's script doesn't load, so there's no check to pass. */
export const TURNSTILE_UNAVAILABLE =
  "Ember couldn't load Cloudflare's check that you're a person. Check your connection, and anything that blocks challenges.cloudflare.com, then reload the page.";

/**
 * `.mb-auth-avatar .input--file`: Campfire's `.btn` as ember-rust's zz-ember.css sets it, holding the
 * file field over itself, outlined while the field has focus, and 44px tall for fingers.
 */
const UPLOAD_BUTTON =
  "relative inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-solid focus-within:outline-foreground touch:min-h-11";

interface Props {
  workspace: SignedOutWorkspace;
  /** The code from the join link, which the Worker checked before serving the page, or null for signing up without one. */
  joinCode: string | null;
  onJoined: (me: Me) => void;
}

/**
 * Creates an account with the join link, or without one while anyone may sign up, with the photo chosen,
 * as a member in every open room, and signs in as it. Signing up without a link waits for Turnstile's
 * check to pass while the deployment has its keys, and draws it afresh for each try.
 */
export function JoinPage({ workspace, joinCode, onJoined }: Props) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const photo = useChosenPhoto();
  const siteKey = joinCode === null ? workspace.turnstileSiteKey : null;
  // The token of the check passed, which is good for one try, and how many tries the check has been drawn for.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useTitle("Sign up");

  async function submit() {
    setBusy(true);
    setProblem(null);
    const person = { name, emailAddress, password: passwordInput.current?.value ?? "" };
    try {
      const chosen = await photo.photo();
      const user = joinCode === null ? await signUp(siteKey === null ? person : { ...person, turnstileToken: turnstileToken ?? "" }, chosen) : await joinWorkspace(joinCode, person, chosen);
      onJoined(user);
    } catch (error) {
      setBusy(false);
      if (siteKey !== null) {
        setTurnstileToken(null);
        setTries((tries) => tries + 1);
      }
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      // An email address with an account goes to sign in with it filled in, and someone who signed in
      // elsewhere meanwhile goes home, as ember-rust redirects both.
      if (error.redirect) return loadPage(error.redirect);
      // The link stopped working while the page was open, and loading it again says so.
      if (error.status === 404) return loadPage(location.pathname);
      // A photo that's refused goes, so the form can be sent without it.
      if (error.field === "avatar") return photo.refuse(error.message);
      setProblem(error.message);
    }
  }

  return (
    <AuthPage workspace={workspace}>
      {problem && <Problem>{problem}</Problem>}
      <AuthCard>
        <AuthHeading title={`Join ${workspace.account.name}`} logo={workspace.account.logo}>Create your account and join the conversation.</AuthHeading>
        <form
          className={AUTH_FORM}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <PhotoField photo={photo} disabled={busy} />
          <Field id="user_name" label="Name" translation="user_name">
            <Input
              id="user_name"
              required
              autoFocus
              autoComplete="name"
              placeholder="Name"
              maxLength={MAX_USER_NAME_LENGTH}
              data-1p-ignore
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={FIELD_INPUT}
            />
          </Field>
          <Field id="user_email_address" label="Email address" translation="email_address">
            <Input
              id="user_email_address"
              type="email"
              required
              autoComplete="username"
              placeholder="Email address"
              maxLength={MAX_EMAIL_ADDRESS_LENGTH}
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
              className={FIELD_INPUT}
            />
          </Field>
          <Field id="user_password" label="Password" translation="password">
            {/* Uncontrolled, so what's typed never reaches its `value` attribute, where custom CSS could read it. */}
            <Input
              ref={passwordInput}
              id="user_password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Password"
              minLength={MIN_PASSWORD_LENGTH}
              maxLength={MAX_PASSWORD_LENGTH}
              className={FIELD_INPUT}
            />
          </Field>
          {siteKey !== null && <TurnstileCheck key={tries} siteKey={siteKey} onToken={setTurnstileToken} onUnavailable={() => setProblem(TURNSTILE_UNAVAILABLE)} />}
          <SubmitButton disabled={busy || (siteKey !== null && turnstileToken === null)}>Create account</SubmitButton>
        </form>
        <AuthAlternative question="Already have an account?" action="Sign in" href="/session/new" />
      </AuthCard>
    </AuthPage>
  );
}

/**
 * ember-rust's `.mb-auth-avatar`: the photo to join with, which shows as it's chosen, over Upload photo,
 * and says why one is refused in place of "Optional". It can't change while the form is sent with it.
 */
function PhotoField({ photo, disabled }: { photo: PhotoChoice; disabled: boolean }) {
  return (
    <div className="mx-auto mb-0.5 flex flex-col items-center justify-center gap-2.5">
      <img src={photo.preview ?? avatarPlaceholder} alt="Your profile photo" width={80} height={80} className="aspect-square w-20 rounded-full object-cover" />
      <label className={UPLOAD_BUTTON}>
        <Camera className="h-5 w-[1.6em]" />
        <input
          ref={photo.input}
          id="user_avatar"
          type="file"
          accept="image/*"
          aria-invalid={photo.refusal ? true : undefined}
          disabled={disabled}
          onChange={photo.choose}
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-default"
        />
        <span>Upload photo</span>
      </label>
      {photo.refusal ? (
        <span role="alert" className="text-[0.8rem] text-destructive">
          {photo.refusal}
        </span>
      ) : (
        <span className="text-[0.8rem] text-muted-foreground">Optional</span>
      )}
    </div>
  );
}
