import { useCallback, useEffect, useState } from "react";
import type { User } from "@ember/protocol";
import { SignIn } from "@/components/sign-in";
import { Workspace } from "@/components/workspace/workspace";
import { ApiError, fetchMe, forgetStoredSession, signOut } from "@/lib/api";

const MAX_RETRY_MS = 15_000;

export function App() {
  // Undefined until the server says who this browser is signed in as, if anyone.
  const [me, setMe] = useState<User | null>();

  useEffect(() => {
    forgetStoredSession();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) =>
      fetchMe().then(
        (user) => !stopped && setMe(user),
        (error) => {
          if (stopped) return;
          if (error instanceof ApiError && error.status === 401) return setMe(null);
          // Being offline, say, tells us nothing about the session, so ask again.
          retry = setTimeout(() => void ask(attempt + 1), Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt));
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

  if (me === undefined) return <main aria-busy="true" className="min-h-dvh bg-surface" />;
  // Someone else's workspace starts afresh, with their own rooms and sockets.
  return me ? <Workspace key={me.id} me={me} onSignOut={signOutHere} onSessionChanged={setMe} /> : <SignIn onSignedIn={setMe} />;
}
