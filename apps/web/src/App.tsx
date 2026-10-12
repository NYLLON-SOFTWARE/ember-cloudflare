import { useCallback, useState } from "react";
import { SignIn } from "@/components/sign-in";
import { Workspace } from "@/components/workspace/workspace";
import { loadSession, saveSession, type Session } from "@/lib/api";

export function App() {
  const [session, setSession] = useState<Session | null>(loadSession);

  const update = useCallback((next: Session | null) => {
    saveSession(next);
    setSession(next);
  }, []);
  const signOut = useCallback(() => update(null), [update]);

  return session ? <Workspace session={session} onSignOut={signOut} /> : <SignIn onSignedIn={update} />;
}
