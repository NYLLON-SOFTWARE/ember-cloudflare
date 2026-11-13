import { useEffectEvent, useRef, useState } from "react";
import type { SkinTone } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { changeSkinTone, isSignedOut } from "@/lib/api";
import { SKIN_TONES, withSkinTone } from "@/lib/skin-tone";

// The Skin tone section of your profile: the tone of the people and hands you type by their :codes and
// add as quick reactions, as Slack's default skin tone is, for your account, so every browser of yours
// has it. A choice saves at once, and shows as it was again if it isn't saved. Arrowing through the
// tones saves the last of those chosen while one saves. Boxed as the Ember AI section is.

/** The hand each tone shows on, as Slack's skin tone picker shows them. */
const HAND = "✋";

interface Props {
  /** Your tone, as the app has it. */
  skinTone: SkinTone;
  /** Gives the app your tone as it's saved. */
  onChanged: (skinTone: SkinTone) => void;
  /** Says why a change wasn't saved, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

export function SkinToneSetting({ skinTone, onChanged, onFailed }: Props) {
  // The tone chosen while it saves. One save runs at a time, so the server takes them in the order
  // they're chosen, and a tone chosen meanwhile waits for it, only the latest, which is then all that counts.
  // Once the section's gone, nothing waits and no answer's given to the app: someone else signing in, in
  // another tab, closes it, and the session is theirs then. The Workspace tells the tab of a tone saved.
  const [choosing, setChoosing] = useState<SkinTone | null>(null);
  const saving = useRef(false);
  const waiting = useRef<SkinTone | null>(null);
  const mounted = useMounted();
  const shown = choosing ?? skinTone;
  // Read as each answer comes, so it goes to whoever's signed in then.
  const saved = useEffectEvent(onChanged);
  const failed = useEffectEvent(onFailed);

  const save = (tone: SkinTone) => {
    saving.current = true;
    const next = () => {
      saving.current = false;
      const chosen = mounted.current ? waiting.current : null;
      waiting.current = null;
      if (chosen !== null) save(chosen);
      return chosen === null;
    };
    changeSkinTone(tone).then(
      (answer) => {
        if (!next() || !mounted.current) return;
        saved(answer);
        setChoosing(null);
      },
      (error: unknown) => {
        if (!next() || (!mounted.current && !isSignedOut(error))) return;
        setChoosing(null);
        failed(error);
      },
    );
  };

  const choose = (tone: SkinTone) => {
    setChoosing(tone);
    if (saving.current) waiting.current = tone;
    else save(tone);
  };

  return (
    <section aria-labelledby="skin-tone-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="skin-tone-heading" className="text-base font-semibold">
        Skin tone
      </h2>
      <p id="skin-tone-explained">The skin tone of the people and hands you add as emoji by their :codes, and as quick reactions.</p>
      <div role="radiogroup" aria-labelledby="skin-tone-heading" aria-describedby="skin-tone-explained" className="flex flex-wrap gap-1">
        {SKIN_TONES.map(({ tone, label }) => (
          <label
            key={tone}
            title={label}
            className="relative grid size-11 cursor-pointer place-items-center rounded-[8px] border border-transparent hover:bg-hover has-checked:border-foreground has-checked:bg-background has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-foreground"
          >
            <input
              type="radio"
              name="skin-tone"
              value={tone}
              checked={shown === tone}
              aria-label={label}
              onChange={() => choose(tone)}
              className="absolute size-px opacity-0 [clip-path:inset(50%)]"
            />
            <span aria-hidden className="text-[1.5rem] leading-none">
              {withSkinTone(HAND, tone)}
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}
