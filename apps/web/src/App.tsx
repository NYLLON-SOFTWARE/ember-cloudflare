import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSFER_PATH, type Account, type Bootstrap, type Me, type NewWorkspace } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { JoinPage } from "@/components/join-page";
import { SetupPage } from "@/components/setup-page";
import { SignInPage } from "@/components/sign-in-page";
import { TransferPage } from "@/components/transfer-page";
import { Workspace, loadPageAhead } from "@/components/workspace/workspace";
import { AccountContext } from "@/hooks/use-account";
import { useAccountLogo } from "@/hooks/use-account-logo";
import { useCustomStyles } from "@/hooks/use-custom-styles";
import { PushProvider } from "@/hooks/use-push";
import { openRoomSocketAhead } from "@/hooks/use-room";
import { joinCodeFromPath, navigate, useIsAt, useJoinRoute } from "@/hooks/use-route";
import { useSelectOnEntry } from "@/hooks/use-select-on-entry";
import { fetchBootstrap, forgetStoredSession, signOut } from "@/lib/api";
import { followAppearance } from "@/lib/appearance";
import { replaceInstallPromptsFor } from "@/lib/install-prompt";
import { loadPage } from "@/lib/page";
import { unsubscribeFromPush } from "@/lib/push";
import { forgetReturnPath, rememberThisPage, takeReturnPath } from "@/lib/return-path";

const MAX_RETRY_MS = 15_000;
/** Where the Set up Ember page is, as in ember-rust. */
const SETUP_PATH = "/first_run";
/** Where the sign-in page is, as in ember-rust. */
const SIGN_IN_PATH = "/session/new";

const isSameAccount = (a: Account, b: Account) =>
  a.name === b.name &&
  a.hideTranslationButtons === b.hideTranslationButtons &&
  a.customStyles === b.customStyles &&
  a.restrictRoomCreation === b.restrictRoomCreation &&
  a.logo === b.logo;

export function App() {
  // Undefined until the server says whether Ember is set up.
  const [workspace, setWorkspace] = useState<Omit<Bootstrap, "user">>();
  const [me, setMe] = useState<Me | null>(null);
  // As in ember-rust, the sign-in page opens even for someone who's signed in.
  const atSignIn = useIsAt(SIGN_IN_PATH);
  const joinCode = useJoinRoute();
  const atTransfer = useIsAt(TRANSFER_PATH);
  const signingOut = useRef(false);
  // Before any page has fields, so even one focused as it opens is selected.
  useSelectOnEntry();

  // Every page keeps up with the device and other tabs, as each of ember-rust's does, rail or not.
  useEffect(() => followAppearance(), []);
  // And has the workspace's custom CSS and logo, once they're known, which is before any page shows.
  useCustomStyles(workspace?.account.customStyles ?? "", me?.administrator === true);
  useAccountLogo(workspace?.account.logo ?? null);

  useEffect(() => {
    forgetStoredSession();
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let letGoOfRoom = () => {};
    const ask = (attempt: number) =>
      fetchBootstrap().then(
        ({ user, ...workspace }) => {
          if (stopped) return;
          replaceInstallPromptsFor(workspace.platform);
          const atSetup = location.pathname === SETUP_PATH;
          // Until Ember is set up, every page is setup's, which the Worker serves or keeps locked.
          if (workspace.setup === "pending" && !atSetup) return loadPage(SETUP_PATH);
          if (workspace.setup === "complete" && atSetup) history.replaceState(history.state, "", "/");
          // The join page is for someone signed out, as in ember-rust, which sends anyone else home.
          const atJoin = joinCodeFromPath(location.pathname) !== null;
          if (user && atJoin) navigate("/", { replace: true });
          // Someone signed out goes to sign in, and comes back here afterwards. A sign-in link signs them in itself.
          if (workspace.setup === "complete" && !user && location.pathname !== SIGN_IN_PATH && !atJoin && location.pathname !== TRANSFER_PATH) {
            rememberThisPage();
            navigate(SIGN_IN_PATH, { replace: true });
          }
          // The room the page shows connects now, while the workspace loads, rather than once it shows.
          if (user && workspace.setup === "complete") letGoOfRoom = openRoomSocketAhead(location.pathname);
          setMe(user);
          setWorkspace(workspace);
        },
        () => {
          // Being offline, say, tells us nothing about the session, so ask again.
          if (!stopped) retry = setTimeout(() => void ask(attempt + 1), Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt));
        },
      );
    // A page few visits need loads while Ember says who's signed in, rather than once the workspace shows.
    void loadPageAhead(location.pathname);
    void ask(0);
    return () => {
      stopped = true;
      clearTimeout(retry);
      letGoOfRoom();
    };
  }, []);

  const signedIn = useCallback((user: Me) => {
    if (location.pathname === SIGN_IN_PATH) navigate(takeReturnPath() ?? "/", { replace: true });
    setMe(user);
  }, []);
  // The session ended, or another tab signed this browser in as someone else. Signing in again
  // starts afresh, as ember-rust's redirect to sign in does, and comes back to this page.
  const sessionChanged = useCallback((user: Me | null) => {
    if (user) return setMe(user);
    // Signing out here goes to sign in itself, whether the rooms close their sockets before or after
    // it's answered.
    if (signingOut.current) return;
    rememberThisPage();
    loadPage(SIGN_IN_PATH);
  }, []);
  // As in ember-rust, a sign-out that doesn't reach the server leaves this browser signed in; one
  // that does goes to sign in, from where signing in again goes home. It settles with whether it did.
  // First, as there, the browser stops taking pushes, whether or not signing out goes on to work.
  const signOutHere = useCallback(() => {
    signingOut.current = true;
    return unsubscribeFromPush().then(signOut).then(
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
  const joined = useCallback((user: Me) => {
    navigate("/", { replace: true });
    setMe(user);
  }, []);
  const setUp = useCallback(({ user }: NewWorkspace) => {
    setMe(user);
    setWorkspace((workspace) => workspace && { ...workspace, setup: "complete" });
  }, []);
  // Every page shows the workspace as its settings last loaded or saved it, or the workspace socket last
  // said it is, which it says again each time it connects.
  const accountChanged = useCallback(
    (account: Account) => setWorkspace((workspace) => workspace && (isSameAccount(workspace.account, account) ? workspace : { ...workspace, account })),
    [],
  );

  // Not flashing yet, so a flash the last page left shows on this one once it's known.
  if (workspace === undefined) return <main aria-busy="true" className="min-h-dvh bg-surface" />;
  // As in ember-rust, a sign-in link signs in whoever opens it, even someone signed in as someone else.
  const showsWorkspace = workspace.setup === "complete" && me !== null && !atSignIn && !atTransfer;
  const page = () => {
    if (workspace.setup === "pending") return <SetupPage placeholders={workspace.setupPlaceholders} onSetUp={setUp} />;
    if (atTransfer) return <TransferPage />;
    // Someone else's workspace starts afresh, with their own rooms and sockets.
    if (showsWorkspace)
      return (
        <PushProvider key={me.id} vapidPublicKey={workspace.vapidPublicKey} platform={workspace.platform}>
          <Workspace
            me={me}
            workspaceName={workspace.account.name}
            version={workspace.version}
            onAccountChanged={accountChanged}
            onSignOut={signOutHere}
            onSessionChanged={sessionChanged}
          />
        </PushProvider>
      );
    if (joinCode !== null) return <JoinPage workspace={workspace} joinCode={joinCode} onJoined={joined} />;
    return <SignInPage workspace={workspace} onSignedIn={signedIn} />;
  };
  // Keyed by who's signed in, so whoever signs in, or in another tab, doesn't see the last page's
  // flash, as ember-rust's redirect after signing in shows none.
  return (
    <AccountContext value={workspace.account}>
      <FlashProvider key={showsWorkspace ? me.id : "signed out"} workspace={showsWorkspace}>
        {page()}
      </FlashProvider>
    </AccountContext>
  );
}
