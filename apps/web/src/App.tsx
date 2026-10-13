import { useCallback, useEffect, useState } from "react";
import type { Bootstrap, NewWorkspace, User } from "@ember/protocol";
import { SetupPage } from "@/components/setup-page";
import { SignIn } from "@/components/sign-in";
import { Workspace } from "@/components/workspace/workspace";
import { fetchBootstrap, forgetStoredSession, signOut } from "@/lib/api";
import { loadPage } from "@/lib/page";

const MAX_RETRY_MS = 15_000;
/** Where the Set up Ember page is, as in ember-rust. */
const SETUP_PATH = "/first_run";

export function App() {
  // Undefined until the server says whether Ember is set up.
  const [setup, setSetup] = useState<Bootstrap["setup"]>();
  const [me, setMe] = useState<User | null>(null);

  useEffect(() => {
    forgetStoredSession();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) =>
      fetchBootstrap().then(
        ({ setup, user }) => {
          if (stopped) return;
          const atSetup = location.pathname === SETUP_PATH;
          // Until Ember is set up, every page is setup's, which the Worker serves or keeps locked.
          if (setup === "pending" && !atSetup) return loadPage(SETUP_PATH);
          if (setup === "complete" && atSetup) history.replaceState(null, "", "/");
          setMe(user);
          setSetup(setup);
        },
        () => {
          // Being offline, say, tells us nothing about the session, so ask again.
          if (!stopped) retry = setTimeout(() => void ask(attempt + 1), Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt));
        },
      );
    void ask(0);
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, []);

  const signedOut = useCallback(() => setMe(null), []);
  // As in ember-rust, a sign-out that doesn't reach the server leaves this browser signed in.
  const signOutHere = useCallback(() => void signOut().then(signedOut, () => {}), [signedOut]);
  const setUp = useCallback(({ user }: NewWorkspace) => {
    setMe(user);
    setSetup("complete");
  }, []);

  if (setup === undefined) return <main aria-busy="true" className="min-h-dvh bg-surface" />;
  if (setup === "pending") return <SetupPage onSetUp={setUp} />;
  // Someone else's workspace starts afresh, with their own rooms and sockets.
  return me ? <Workspace key={me.id} me={me} onSignOut={signOutHere} onSessionChanged={setMe} /> : <SignIn onSignedIn={setMe} />;
}
