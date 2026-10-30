import { useState } from "react";
import type { WorkspaceSettings } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { forgetTurnstileKeys, isSignedOut } from "@/lib/api";
import { BUTTON } from "./email-settings";

// This port's own Turnstile card in Membership (`auth.turnstile`), for administrators: whether Cloudflare
// Turnstile checks that whoever signs up, or asks Ember to email them, is a person, with the keys of the
// widget an administrator gave Ember, or the deployment's secrets, which nothing here changes. Until it
// does, Set up Turnstile opens the steps to it (`TurnstileSetup`), as Change does once it does with the
// keys given, and Stop using Turnstile takes them away. Laid out as the Email card is.

/** What Stop using Turnstile asks first, since the limits on each network stand in for its check then. */
export const CONFIRM_STOP_TURNSTILE =
  "Are you sure you want Ember to stop using Turnstile? It will forget the widget's keys, and limits on each network will stand in for its check until Turnstile is set up again.";

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

/** Whom Turnstile's check is for. */
const CHECKED = "whoever signs up, or asks Ember to email them a link to join or a code to reset a password, is a person";

interface Props {
  turnstile: WorkspaceSettings["turnstile"];
  /** Opens Set up Turnstile. */
  onSetUp: () => void;
  /** Shows where Ember's Turnstile keys come from once Stop using Turnstile has taken the ones given away. */
  onStopped: (turnstile: WorkspaceSettings["turnstile"]) => void;
  /** Says why stopping failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Whether Turnstile checks people, for administrators, and with whose keys, or else that limits stand in for it. */
export function TurnstileSettings({ turnstile, onSetUp, onStopped, onFailed }: Props) {
  const [stopping, setStopping] = useState(false);
  const mounted = useMounted();

  const stop = () => {
    if (!confirm(CONFIRM_STOP_TURNSTILE)) return;
    setStopping(true);
    forgetTurnstileKeys().then(
      (turnstile) => {
        onStopped(turnstile);
        if (mounted.current) setStopping(false);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setStopping(false);
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby="turnstile-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div>
        <h2 id="turnstile-heading" className="text-base font-semibold">
          Turnstile
        </h2>
        <p className={NOTE}>
          {turnstile === null
            ? `Cloudflare Turnstile can check that ${CHECKED}. Until it does, limits on each network stand in for its check.`
            : `Cloudflare Turnstile checks that ${CHECKED}${turnstile === "secret" ? ", with the widget whose keys are in TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY" : ""}.`}
        </p>
      </div>
      {turnstile === null && <SetUpTurnstile onSetUp={onSetUp} />}
      {turnstile === "saved" && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={onSetUp} disabled={stopping} className={BUTTON}>
            Change
          </button>
          <button type="button" onClick={stop} disabled={stopping} className={BUTTON}>
            Stop using Turnstile
          </button>
        </div>
      )}
    </section>
  );
}

/** Set up Turnstile, which the card has until Ember has a widget's keys, as the ways to join whose limits stand in for its check have under them. */
export function SetUpTurnstile({ onSetUp }: { onSetUp: () => void }) {
  return (
    <div>
      <button type="button" onClick={onSetUp} className={BUTTON}>
        Set up Turnstile
      </button>
    </div>
  );
}
