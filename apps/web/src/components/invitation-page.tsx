import { useEffect, useState } from "react";
import { INVITATION_GONE, type Me } from "@ember/protocol";
import { AuthAlternative } from "@/components/auth-alternative";
import { AuthCard, AuthHeading, AuthPage, type SignedOutWorkspace } from "@/components/auth-page";
import { JoinPage, type Invitation } from "@/components/join-page";
import { useTitle } from "@/hooks/use-title";
import { ApiError, lookUpEmailLink } from "@/lib/api";

// This port's own page for an invitation's link (`auth.invitation-sign-up`), which holds its secret in
// the fragment: it takes the secret out of the address, as the sign-in link's page does, asks whom the
// link is for, which spends nothing, and shows the join form with that address, or says the link
// doesn't work.

const MAX_RETRY_MS = 15_000;

/** The secret in an invitation link's fragment (`invitationLink`). */
const tokenOf = (hash: string) => new URLSearchParams(hash.slice(1)).get("token") || null;

interface Props {
  workspace: SignedOutWorkspace;
  onJoined: (me: Me) => void;
}

/** The join page for the invitation whose link opened it, once it's looked up. */
export function InvitationPage(props: Props) {
  // Opening another link over this page only changes the fragment, which loads no new page, so each
  // starts afresh here.
  const [opened, setOpened] = useState(0);
  useEffect(() => {
    const open = () => setOpened((count) => count + 1);
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []);
  return <InvitationLookup key={opened} {...props} />;
}

/**
 * Looks up the invitation whose secret is in the address's fragment, clearing the fragment first, so the
 * secret leaves the address bar and this tab's history. A request that can't reach Ember, or that Ember
 * fails, is tried again, as the app's first one is.
 */
function InvitationLookup({ workspace, onJoined }: Props) {
  const [token] = useState(() => tokenOf(location.hash));
  const [invitation, setInvitation] = useState<Invitation | "looking" | "gone">(token === null ? "gone" : "looking");

  useEffect(() => {
    history.replaceState(history.state, "", location.pathname + location.search);
    if (token === null) return;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const lookUp = (attempt: number) =>
      lookUpEmailLink(token).then(
        ({ emailAddress }) => !stopped && setInvitation({ token, emailAddress }),
        (error: unknown) => {
          if (stopped) return;
          if (error instanceof ApiError && error.status < 500) setInvitation("gone");
          else retry = setTimeout(() => void lookUp(attempt + 1), Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt));
        },
      );
    void lookUp(0);
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, [token]);

  if (invitation === "looking") return <main aria-busy="true" className="min-h-dvh bg-surface" />;
  if (invitation === "gone") return <InvitationGone workspace={workspace} />;
  return <JoinPage workspace={workspace} joinCode={null} invitation={invitation} onJoined={onJoined} />;
}

/** What an invitation's link that doesn't work opens: why, and sign-in, for someone with an account. */
function InvitationGone({ workspace }: { workspace: SignedOutWorkspace }) {
  useTitle("Sign up");
  return (
    <AuthPage workspace={workspace}>
      <AuthCard>
        <AuthHeading title={`Join ${workspace.account.name}`} logo={workspace.account.logo}>
          {INVITATION_GONE}
        </AuthHeading>
        <AuthAlternative question="Already have an account?" action="Sign in" href="/session/new" />
      </AuthCard>
    </AuthPage>
  );
}
