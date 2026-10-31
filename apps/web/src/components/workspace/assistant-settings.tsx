import { useState } from "react";
import type { WorkspaceSettings } from "@ember/protocol";
import { modelName, type AnswerLevelChanges, type AssistantSettings as Assistant } from "@ember/protocol/assistant";
import { Switch } from "@/components/ui/switch";
import { useMounted } from "@/hooks/use-mounted";
import { changeAssistantMost, forgetAssistant, isSignedOut } from "@/lib/api";
import { BUTTON } from "./email-settings";
import { LevelDials } from "./level-dials";

// The Ember AI card on the AI assistant tab, for administrators: whether @ember, an AI assistant in every
// room open to everyone, runs on a model through Cloudflare AI Gateway, and which. Its switch says
// whether it does, as Turnstile's does. Turning it on opens Set up Ember AI (`AssistantSetup`), as
// switches open setup that's missing, as the project's owner asked (2026-10-26), and turning it off takes
// @ember out of every room and forgets the API token. Change opens the setup with the account and model
// as they are. While it's on, the card says what @ember sends the model, which its provider reads, and
// has the dials of the most @ember may think and write for anyone's question, which save at once.

/** What @ember sends the model as it answers, which the card says while Ember AI is on. */
export const WHAT_EMBER_SENDS = "Mention @ember, or write to it directly, and it answers, sending the thread, or the room's latest messages, through Cloudflare to the model.";

/** What the card says of its dials. */
export const LIMITS_EXPLAINED =
  "The most @ember may think and write for anyone's question. Each person picks their own levels on their profile, up to these. AI Gateway's spend limits can cap what each person's questions cost, as every request says who asked.";

/** What turning Ember AI off asks first. */
export const CONFIRM_STOP_ASSISTANT = "Are you sure you want to turn off Ember AI? @ember will leave every room, and Ember will forget the API token.";

const NOTE = "text-[0.8em] text-muted-foreground max-md:text-[12px]";

interface Props {
  assistant: WorkspaceSettings["assistant"];
  /** Opens Set up Ember AI. */
  onSetUp: () => void;
  /** Shows that Ember AI is off, once turning it off has. */
  onStopped: () => void;
  /** Shows Ember AI as a change to its dials leaves it, or as it was again when the change fails. */
  onChanged: (assistant: Assistant) => void;
  /** Says why turning it off failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Whether @ember runs on a model, for administrators, and which, or else what Ember AI would add. */
export function AssistantSettings({ assistant, onSetUp, onStopped, onChanged, onFailed }: Props) {
  const [stopping, setStopping] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();

  /** Shows `changes` to the most at once, and saves them, showing the most as it was again if they aren't saved. */
  const changeMost = (shown: Assistant, changes: AnswerLevelChanges) => {
    setSaving(true);
    onChanged({ ...shown, most: { ...shown.most, ...changes } });
    changeAssistantMost(changes).then(
      (changed) => {
        onChanged(changed);
        if (mounted.current) setSaving(false);
      },
      (error: unknown) => {
        onChanged(shown);
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

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
        <>
          <p className={NOTE}>{WHAT_EMBER_SENDS}</p>
          <div>
            <button type="button" onClick={onSetUp} disabled={stopping} className={BUTTON}>
              Change
            </button>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4">
            <div>
              <h3 className="text-sm font-semibold">Limits</h3>
              <p className={NOTE}>{LIMITS_EXPLAINED}</p>
            </div>
            <LevelDials name="assistant-most" levels={assistant.most} disabled={stopping || saving} onChange={(changes) => changeMost(assistant, changes)} />
          </div>
        </>
      )}
    </section>
  );
}
