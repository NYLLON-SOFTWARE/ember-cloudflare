import { useState } from "react";
import { MAX_EMAIL_ADDRESS_LENGTH, MAX_PASSWORD_LENGTH, MAX_USER_NAME_LENGTH, type Me } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AuthCard, AuthHeading, AuthPage, Problem, type SignedOutWorkspace } from "@/components/auth-page";
import avatarPlaceholder from "@/components/avatar-placeholder.svg";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Camera } from "@/components/icons/campfire";
import { Input } from "@/components/ui/input";
import { useChosenPhoto, type PhotoChoice } from "@/hooks/use-chosen-photo";
import { useTitle } from "@/hooks/use-title";
import { ApiError, joinWorkspace } from "@/lib/api";
import { loadPage } from "@/lib/page";

// ember-rust's join page (crates/views/templates/users/new.html), which the workspace's join link
// opens for someone signed out.

/**
 * `.mb-auth-avatar .input--file`: Campfire's `.btn` as ember-rust's zz-ember.css sets it, holding the
 * file field over itself, outlined while the field has focus, and 44px tall for fingers.
 */
const UPLOAD_BUTTON =
  "relative inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-solid focus-within:outline-foreground touch:min-h-11";

interface Props {
  workspace: SignedOutWorkspace;
  /** The code from the join link, which the Worker checked before serving the page. */
  joinCode: string;
  onJoined: (me: Me) => void;
}

/** Creates an account with the join link, with the photo chosen, as a member in every open room, and signs in as it. */
export function JoinPage({ workspace, joinCode, onJoined }: Props) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const photo = useChosenPhoto();

  useTitle("Sign up");

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onJoined(await joinWorkspace(joinCode, { name, emailAddress, password }, await photo.photo()));
    } catch (error) {
      setBusy(false);
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
            <Input
              id="user_password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={FIELD_INPUT}
            />
          </Field>
          <SubmitButton disabled={busy}>Create account</SubmitButton>
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
        <Camera width={20} height={20} className="h-5 w-[1.6em]" />
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
