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
import { ApiError, joinWithInvitation, joinWorkspace, signUp, type ChosenPhoto } from "@/lib/api";
import { loadPage } from "@/lib/page";

// ember-rust's join page (crates/views/templates/users/new.html), which the workspace's join link
// opens for someone signed out. Without a code it's open sign-up's page, this port's own
// (`auth.open-sign-up`), which shows Turnstile's check while the deployment has its keys, and with an
// invitation it's the invitation's (`auth.invitation-sign-up`), which joins with its email address.

/** What the page says when Turnstile's script doesn't load, so there's no check to pass. */
export const TURNSTILE_UNAVAILABLE =
  "Ember couldn't load Cloudflare's check that you're a person. Check your connection, and anything that blocks challenges.cloudflare.com, then reload the page.";

/**
 * `.mb-auth-avatar .input--file`: Campfire's `.btn` as ember-rust's zz-ember.css sets it, holding the
 * file field over itself, outlined while the field has focus, and 44px tall for fingers.
 */
const UPLOAD_BUTTON =
  "relative inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-solid focus-within:outline-foreground touch:min-h-11";

/** An invitation to join with: its link's secret, and the email address it's for. */
export interface Invitation {
  token: string;
  emailAddress: string;
}

interface Props {
  workspace: SignedOutWorkspace;
  /** The code from the join link, which the Worker checked before serving the page, or null for signing up without one. */
  joinCode: string | null;
  /** The invitation to join with, which its page has looked up, in place of a join code. */
  invitation?: Invitation;
  onJoined: (me: Me) => void;
}

/**
 * Creates an account with the join link, or an invitation, with its email address, or without either
 * while anyone may sign up, with the photo chosen, as a member in every open room, and signs in as it.
 * Signing up without a link waits for Turnstile's check to pass while the deployment has its keys, and
 * draws it afresh for each try.
 */
export function JoinPage({ workspace, joinCode, invitation, onJoined }: Props) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState(invitation?.emailAddress ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const photo = useChosenPhoto();
  const siteKey = joinCode === null && !invitation ? workspace.turnstileSiteKey : null;
  // The token of the check passed, which is good for one try, and how many tries the check has been drawn for.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [tries, setTries] = useState(0);

  useTitle("Sign up");

  /** Joins as the person the form describes, with the photo chosen, by the way the page is for. */
  function join(password: string, chosen: ChosenPhoto | null): Promise<Me> {
    if (invitation) return joinWithInvitation({ token: invitation.token, name, password }, chosen);
    const person = { name, emailAddress, password };
    if (joinCode !== null) return joinWorkspace(joinCode, person, chosen);
    return signUp(siteKey === null ? person : { ...person, turnstileToken: turnstileToken ?? "" }, chosen);
  }

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onJoined(await join(passwordInput.current?.value ?? "", await photo.photo()));
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
      // The link stopped working while the page was open, and loading it again says so, as it does an
      // invitation's, whose secret has left the address.
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
              readOnly={invitation !== undefined}
              aria-describedby={invitation ? "user_email_address_description" : undefined}
              autoComplete="username"
              placeholder="Email address"
              maxLength={MAX_EMAIL_ADDRESS_LENGTH}
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
              className={FIELD_INPUT}
            />
            {invitation && (
              <span id="user_email_address_description" className="text-[0.8rem] text-muted-foreground">
                Your invitation is for this address.
              </span>
            )}
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
