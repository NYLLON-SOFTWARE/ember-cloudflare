import { useEffect, useLayoutEffect, useState } from "react";
import type { Me } from "@ember/protocol";
import { APPS_FORBIDDEN, type AppSignedIn, type AppSignInReturn } from "@ember/protocol/apps";
import { useFlash } from "@/components/flash";
import { PageLink } from "@/components/page-link";
import { appSettingsPath, navigate } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, finishAppSignIn, isSignedOut } from "@/lib/api";
import { AGENTS_PATH, useAgentsOnly } from "./agent-list";
import { connectedNotice } from "./app-page";
import { BUTTON } from "./email-settings";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

// Where an app's authorization server sends an administrator's browser back, once they've signed in
// there: the page takes what came back out of the address, has Ember finish the sign-in with it, and
// goes on to the app's page, or says why not.

/** What the page says while Ember finishes the sign-in, which reads the app's tools. */
export const FINISHING_SIGN_IN = "Ember is finishing the sign-in and reading the app's tools.";

/** What the page says of a sign-in its server didn't go through with: one the administrator turned down there, and any other. */
export const SIGN_IN_TURNED_DOWN = "The sign-in was turned down there, so nothing has changed.";
export const SIGN_IN_NOT_FINISHED = "The sign-in wasn't finished there, so nothing has changed. Start it again.";

/** What a page says once Ember is signed in to `app`'s server again. */
export const signedInAgainNotice = (app: { name: string }) => `Ember is signed in to ${app.name} again.`;

/** What an authorization server sent the browser back with, in the address: a code for the sign-in begun as `state`, with who it says it is, or why there's none. */
interface CameBack {
  state: string | null;
  code: string | null;
  iss: string | null;
  error: string | null;
}

function cameBack(): CameBack {
  const query = new URLSearchParams(location.search);
  return { state: query.get("state"), code: query.get("code"), iss: query.get("iss"), error: query.get("error") };
}

/** What Ember finishes the sign-in with, or why it can't be finished, said in the page's own words: an authorization server's aren't shown. */
function returnOf({ state, code, iss, error }: CameBack): AppSignInReturn | string {
  if (error === "access_denied") return SIGN_IN_TURNED_DOWN;
  if (error !== null || !state || !code) return SIGN_IN_NOT_FINISHED;
  return { state, code, ...(iss !== null && { iss }) };
}

// A sign-in is finished once, so a page that asks twice, as React has one do while it's developed, is answered once.
const finishing = new Map<string, Promise<AppSignedIn>>();

function finishOnce(back: AppSignInReturn): Promise<AppSignedIn> {
  const asked = finishing.get(back.state) ?? finishAppSignIn(back);
  finishing.set(back.state, asked);
  return asked;
}

interface Props {
  me: Me;
  /** Says why something failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The page a sign-in to an app's server comes back to, which only administrators may open while Ember AI
 * is on, as Connect an app: it goes on to the app's page once Ember has finished the sign-in, saying the
 * app is connected, or signed in to again, and otherwise says why it wasn't, with the way back to the apps.
 */
export function AppSignedInPage({ me, onFailed }: Props) {
  const [back] = useState(() => returnOf(cameBack()));
  const [problem, setProblem] = useState(typeof back === "string" ? back : null);
  const { forbidden, failed } = useAgentsOnly(onFailed);
  const flash = useFlash();
  useTitle("Signing in to an app");

  useLayoutEffect(() => {
    if (!me.administrator) forbidden(APPS_FORBIDDEN);
  }, [me.administrator, forbidden]);

  useEffect(() => {
    // The code leaves the address bar and this tab's history.
    history.replaceState(history.state, "", location.pathname);
    if (!me.administrator || typeof back === "string") return;
    let stopped = false;
    finishOnce(back).then(
      ({ app, again }) => {
        if (stopped) return;
        navigate(appSettingsPath(app.id), { replace: true });
        flash("notice", again ? signedInAgainNotice(app) : connectedNotice(app));
      },
      (error: unknown) => {
        if (stopped && !isSignedOut(error)) return;
        if (error instanceof ApiError && error.status === 422) setProblem(error.message);
        else failed(error);
      },
    );
    return () => void (stopped = true);
  }, [me.administrator, back, flash, failed]);

  return (
    <SettingsPage back={AGENTS_PATH}>
      <Panel aria-busy={problem === null}>
        {problem === null ? (
          <PageHeading title="Signing in…">{FINISHING_SIGN_IN}</PageHeading>
        ) : (
          <>
            <PageHeading title="The app isn't signed in to">
              <span role="alert" className="wrap-anywhere">
                {problem}
              </span>
            </PageHeading>
            <PageLink href={AGENTS_PATH} className={BUTTON}>
              Back to the apps
            </PageLink>
          </>
        )}
      </Panel>
    </SettingsPage>
  );
}
