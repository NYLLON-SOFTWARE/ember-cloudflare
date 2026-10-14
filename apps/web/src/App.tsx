import { useCallback, useEffect, useRef, useState } from "react";
import type { Bootstrap, NewWorkspace, User } from "@ember/protocol";
import { JoinPage } from "@/components/join-page";
import { SetupPage } from "@/components/setup-page";
import { SignInPage } from "@/components/sign-in-page";
import { Workspace } from "@/components/workspace/workspace";
import { joinCodeFromPath, navigate, useIsAt, useJoinRoute } from "@/hooks/use-route";
import { fetchBootstrap, forgetStoredSession, signOut } from "@/lib/api";
import { loadPage } from "@/lib/page";
import { forgetReturnPath, rememberThisPage, takeReturnPath } from "@/lib/return-path";

const MAX_RETRY_MS = 15_000;
/** Where the Set up Ember page is, as in ember-rust. */
const SETUP_PATH = "/first_run";
/** Where the sign-in page is, as in ember-rust. */
const SIGN_IN_PATH = "/session/new";

export function App() {
  // Undefined until the server says whether Ember is set up.
  const [workspace, setWorkspace] = useState<Omit<Bootstrap, "user">>();
  const [me, setMe] = useState<User | null>(null);
  // As in ember-rust, the sign-in page opens even for someone who's signed in.
  const atSignIn = useIsAt(SIGN_IN_PATH);
  const joinCode = useJoinRoute();
  const signingOut = useRef(false);

  useEffect(() => {
    forgetStoredSession();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) =>
      fetchBootstrap().then(
        ({ user, ...workspace }) => {
          if (stopped) return;
          const atSetup = location.pathname === SETUP_PATH;
          // Until Ember is set up, every page is setup's, which the Worker serves or keeps locked.
          if (workspace.setup === "pending" && !atSetup) return loadPage(SETUP_PATH);
          if (workspace.setup === "complete" && atSetup) history.replaceState(history.state, "", "/");
          // The join page is for someone signed out, as in ember-rust, which sends anyone else home.
          const atJoin = joinCodeFromPath(location.pathname) !== null;
          if (user && atJoin) navigate("/", { replace: true });
          // Someone signed out goes to sign in, and comes back here afterwards.
          if (workspace.setup === "complete" && !user && location.pathname !== SIGN_IN_PATH && !atJoin) {
            rememberThisPage();
            navigate(SIGN_IN_PATH, { replace: true });
          }
          setMe(user);
          setWorkspace(workspace);
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

  const signedIn = useCallback((user: User) => {
    if (location.pathname === SIGN_IN_PATH) navigate(takeReturnPath() ?? "/", { replace: true });
    setMe(user);
  }, []);
  // The session ended, or another tab signed this browser in as someone else. Signing in again
  // starts afresh, as ember-rust's redirect to sign in does, and comes back to this page.
  const sessionChanged = useCallback((user: User | null) => {
    if (user) return setMe(user);
    // Signing out here goes to sign in itself, whether the rooms close their sockets before or after
    // it's answered.
    if (signingOut.current) return;
    rememberThisPage();
    loadPage(SIGN_IN_PATH);
  }, []);
  // As in ember-rust, a sign-out that doesn't reach the server leaves this browser signed in; one
  // that does goes to sign in, from where signing in again goes home. It settles with whether it did.
  const signOutHere = useCallback(() => {
    signingOut.current = true;
    return signOut().then(
      () => {
        forgetReturnPath();
        loadPage(SIGN_IN_PATH);
        return true;
      },
      () => {
        signingOut.current = false;
        return false;
      },
    );
  }, []);
  // As in ember-rust, someone who joins goes home, signed in.
  const joined = useCallback((user: User) => {
    navigate("/", { replace: true });
    setMe(user);
  }, []);
  const setUp = useCallback(({ user }: NewWorkspace) => {
    setMe(user);
    setWorkspace((workspace) => workspace && { ...workspace, setup: "complete" });
  }, []);

  if (workspace === undefined) return <main aria-busy="true" className="min-h-dvh bg-surface" />;
  if (workspace.setup === "pending") return <SetupPage onSetUp={setUp} />;
  // Someone else's workspace starts afresh, with their own rooms and sockets.
  if (me && !atSignIn) return <Workspace key={me.id} me={me} onSignOut={signOutHere} onSessionChanged={sessionChanged} />;
  if (joinCode !== null) return <JoinPage workspace={workspace} joinCode={joinCode} onJoined={joined} />;
  return <SignInPage workspace={workspace} onSignedIn={signedIn} />;
}
