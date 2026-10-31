import { useState } from "react";
import type { AnswerLevelChanges, YourAnswerLevels } from "@ember/protocol/assistant";
import { useMounted } from "@/hooks/use-mounted";
import { changeAnswerLevels, isSignedOut } from "@/lib/api";
import { LevelDials } from "./level-dials";

// The Ember AI section of your profile, while Ember AI is on: how much @ember thinks before it answers
// you, and how long its answers to you are, up to the most administrators allow. A choice saves at once,
// and shows as it was again if it isn't saved. Boxed as the Memberful section is.

interface Props {
  /** Your levels, and the most each may be. */
  assistant: YourAnswerLevels;
  /** Shows your levels as a change leaves them, or as they were again when it fails, or none once Ember AI is off. */
  onChanged: (assistant: YourAnswerLevels | null) => void;
  /** Says why a change wasn't saved, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Your Thinking and Answer length dials, each up to the most administrators allow. */
export function AnswerLevels({ assistant, onChanged, onFailed }: Props) {
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();

  const change = (changes: AnswerLevelChanges) => {
    setSaving(true);
    onChanged({ ...assistant, levels: { ...assistant.levels, ...changes } });
    changeAnswerLevels(changes).then(
      (changed) => {
        if (!mounted.current) return;
        setSaving(false);
        onChanged(changed);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onChanged(assistant);
        onFailed(error);
      },
    );
  };

  return (
    <section aria-labelledby="answer-levels-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="answer-levels-heading" className="text-base font-semibold">
        Ember AI
      </h2>
      <p>How much @ember thinks before it answers you, and how long its answers are, up to the most an administrator allows.</p>
      <LevelDials name="answer-levels" levels={assistant.levels} most={assistant.most} disabled={saving} onChange={change} />
    </section>
  );
}
