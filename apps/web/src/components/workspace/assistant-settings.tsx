import { useState } from "react";
import type { WorkspaceSettings } from "@ember/protocol";
import { modelName } from "@ember/protocol/assistant";
import { Switch } from "@/components/ui/switch";
import { useMounted } from "@/hooks/use-mounted";
import { forgetAssistant, isSignedOut } from "@/lib/api";
import { BUTTON } from "./email-settings";

// The Ember AI card on the AI assistant tab, for administrators: whether @ember, an AI assistant in every
// room open to everyone, runs on a model through Cloudflare AI Gateway, and which. Its switch says
// whether it does, as Turnstile's does. Turning it on opens Set up Ember AI (`AssistantSetup`), as
// switches open setup that's missing, as the project's owner asked (2026-10-26), and turning it off takes
// @ember out of every room and forgets the API token. Change opens the setup with the account and model
// as they are.

/** What turning Ember AI off asks first. */
export const CONFIRM_STOP_ASSISTANT = "Are you sure you want to turn off Ember AI? @ember will leave every room, and Ember will forget the API token.";

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  assistant: WorkspaceSettings["assistant"];
  /** Opens Set up Ember AI. */
  onSetUp: () => void;
  /** Shows that Ember AI is off, once turning it off has. */
  onStopped: () => void;
  /** Says why turning it off failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Whether @ember runs on a model, for administrators, and which, or else what Ember AI would add. */
export function AssistantSettings({ assistant, onSetUp, onStopped, onFailed }: Props) {
  const [stopping, setStopping] = useState(false);
  const mounted = useMounted();

  const stop = () => {
    if (!confirm(CONFIRM_STOP_ASSISTANT)) return;
    setStopping(true);
    forgetAssistant().then(
      () => {
        onStopped();
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
    <section aria-labelledby="assistant-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div className="flex items-center gap-x-[1ch] gap-y-4">
        <div className="min-w-0 flex-1">
          <h2 id="assistant-heading" className="text-base font-semibold">
            Ember AI
          </h2>
          <p id="assistant-description" className={NOTE}>
            {assistant === null ? (
              "Ember AI adds @ember, an AI assistant, to every room open to everyone, running on a model you choose through Cloudflare AI Gateway."
            ) : (
              <>
                @ember runs on <strong className="font-semibold wrap-anywhere">{modelName(assistant.model)}</strong> through Cloudflare AI Gateway.
              </>
            )}
          </p>
        </div>
        <Switch
          checked={assistant !== null && !stopping}
          onCheckedChange={(on) => (on ? onSetUp() : stop())}
          disabled={stopping}
          aria-labelledby="assistant-heading"
          aria-describedby="assistant-description"
        />
      </div>
      {assistant !== null && (
        <div>
          <button type="button" onClick={onSetUp} disabled={stopping} className={BUTTON}>
            Change
          </button>
        </div>
      )}
    </section>
  );
}
