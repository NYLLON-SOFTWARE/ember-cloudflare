import { useState } from "react";
import { MAX_PASSWORD_LENGTH, type User } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AUTH_FORM, AUTH_INPUT, AuthCard, AuthHeading, AuthPage, Field, Problem, SubmitButton, useTitle, type SignedOutWorkspace } from "@/components/auth-page";
import { Input } from "@/components/ui/input";
import { ApiError, joinWorkspace } from "@/lib/api";
import { loadPage } from "@/lib/page";

// ember-rust's join page (crates/views/templates/users/new.html), which the workspace's join link
// opens for someone signed out. It has no profile photo yet: that waits for file uploads, as setup's
// does.

interface Props {
  workspace: SignedOutWorkspace;
  /** The code from the join link, which the Worker checked before serving the page. */
  joinCode: string;
  onJoined: (me: User) => void;
}

/** Creates an account with the join link, as a member in every open room, and signs in as it. */
export function JoinPage({ workspace, joinCode, onJoined }: Props) {
  const [name, setName] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useTitle("Sign up");

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      onJoined(await joinWorkspace(joinCode, { name, emailAddress, password }));
    } catch (error) {
      setBusy(false);
      if (!(error instanceof ApiError)) return setProblem("Couldn't reach Ember. Check your connection and try again.");
      // An email address with an account goes to sign in with it filled in, and someone who signed in
      // elsewhere meanwhile goes home, as ember-rust redirects both.
      if (error.redirect) return loadPage(error.redirect);
      // The link stopped working while the page was open, and loading it again says so.
      if (error.status === 404) return loadPage(location.pathname);
      setProblem(error.message);
    }
  }

  return (
    <AuthPage workspace={workspace}>
      {problem && <Problem>{problem}</Problem>}
      <AuthCard>
        <AuthHeading title={`Join ${workspace.account.name}`}>Create your account and join the conversation.</AuthHeading>
        <form
          className={AUTH_FORM}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field id="user_name" label="Name">
            <Input
              id="user_name"
              required
              autoFocus
              autoComplete="name"
              placeholder="Name"
              data-1p-ignore
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={AUTH_INPUT}
            />
          </Field>
          <Field id="user_email_address" label="Email address">
            <Input
              id="user_email_address"
              type="email"
              required
              autoComplete="username"
              placeholder="Email address"
              value={emailAddress}
              onChange={(event) => setEmailAddress(event.target.value)}
              className={AUTH_INPUT}
            />
          </Field>
          <Field id="user_password" label="Password">
            <Input
              id="user_password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="Password"
              maxLength={MAX_PASSWORD_LENGTH}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={AUTH_INPUT}
            />
          </Field>
          <SubmitButton disabled={busy}>Create account</SubmitButton>
        </form>
        <AuthAlternative question="Already have an account?" action="Sign in" href="/session/new" />
      </AuthCard>
    </AuthPage>
  );
}
