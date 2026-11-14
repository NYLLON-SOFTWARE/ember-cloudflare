import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { MAX_MOOD_EMOJI_LENGTH, MAX_MOOD_TEXT_LENGTH, sameMood, type PersonMood, type ProfileAnswer } from "@ember/protocol";
import { AUTH_FORM } from "@/components/auth-page";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMounted } from "@/hooks/use-mounted";
import { changeProfile, isSignedOut } from "@/lib/api";
import { choiceOf, clearAtOf, currentMood, CLEAR_CHOICES, type ClearChoice } from "@/lib/mood";
import { cn } from "@/lib/utils";
import { NOTE, SELECT } from "./model-picker";

interface Props {
  /** The mood you wear, or null while you wear none. */
  mood: PersonMood | null;
  /** Says the mood `worn` a save of it is sending, or that a clearing is sending none, before its answer comes. */
  onSaving: (worn: PersonMood | null) => void;
  /** Shows your mood as a save or its clearing answered it, flashing what they did. */
  onSaved: (answer: ProfileAnswer) => void;
  /** Says why saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** The emoji and words typed, coming off when the Clear-at menu says, or null while either is blank. */
const moodOf = (emoji: string, text: string, clearAt: ClearChoice, now: Date): PersonMood | null => {
  const wornEmoji = emoji.trim();
  const wornText = text.trim();
  return wornEmoji === "" || wornText === "" ? null : { emoji: wornEmoji, text: wornText, clearAt: clearAtOf(clearAt, now) };
};

/** The Clear-at menu's choice for when a mood comes off by itself, or Never for none, or for one whose time has passed. */
const choiceOfClearAt = (mood: PersonMood | null): ClearChoice => {
  const worn = currentMood(mood);
  return worn?.clearAt ? choiceOf(worn.clearAt) : "never";
};

/**
 * The mood section of your profile, boxed as the Ember AI section is: an emoji and a few words beside
 * your name, which everyone sees until it comes off by itself at the Clear-at menu's time, or until
 * Clear takes it off. Save mood wears what's typed, with the notice "✓", keeping the page. Another
 * tab's change replaces what's typed that shows it.
 */
export function MoodEditor({ mood, onSaving, onSaved, onFailed }: Props) {
  const [emoji, setEmoji] = useState(mood?.emoji ?? "");
  const [text, setText] = useState(mood?.text ?? "");
  const [clearAt, setClearAt] = useState<ClearChoice>(choiceOfClearAt(mood));
  /** The mood as the page last loaded or saved it. */
  const saved = useRef(mood);
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();

  // What another tab has saved takes the place of what's typed that still shows what was here before it.
  useEffect(() => {
    if (!sameMood(mood, saved.current)) {
      saved.current = mood;
      setEmoji(mood?.emoji ?? "");
      setText(mood?.text ?? "");
      setClearAt(choiceOfClearAt(mood));
    }
  }, [mood]);

  /** Shows what `answer` says you wear, once a save or its clearing has settled. */
  function settled(answer: ProfileAnswer) {
    setSaving(false);
    saved.current = answer.profile.mood;
    setEmoji(answer.profile.mood?.emoji ?? "");
    setText(answer.profile.mood?.text ?? "");
    setClearAt(choiceOfClearAt(answer.profile.mood));
    onSaved(answer);
  }

  const change = (set: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => set(event.target.value);
  const choose = (event: ChangeEvent<HTMLSelectElement>) => setClearAt(event.target.value as ClearChoice);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const worn = moodOf(emoji, text, clearAt, new Date());
    if (!worn || saving) return;
    setSaving(true);
    onSaving(worn);
    changeProfile({ mood: worn }).then(
      (answer) => mounted.current && settled(answer),
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  const clear = () => {
    if (mood === null || saving) return;
    setSaving(true);
    onSaving(null);
    changeProfile({ mood: null }).then(
      (answer) => mounted.current && settled(answer),
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  const typed = emoji.trim() !== "" && text.trim() !== "";

  return (
    <section aria-labelledby="mood-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="mood-heading" className="text-base font-semibold">
        Mood
      </h2>
      <p>An emoji and a few words beside your name, which everyone sees until it comes off.</p>
      <form onSubmit={save} className={cn(AUTH_FORM, "gap-4")}>
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <Field id="user_mood_emoji" label="Emoji">
            <Input
              id="user_mood_emoji"
              placeholder="😌"
              maxLength={MAX_MOOD_EMOJI_LENGTH}
              required
              disabled={saving}
              value={emoji}
              onChange={change(setEmoji)}
              className={cn(FIELD_INPUT, "w-[10em] max-md:w-full")}
            />
          </Field>
          <Field id="user_mood_text" label="Words">
            <Input
              id="user_mood_text"
              placeholder="A few words beside your name"
              maxLength={MAX_MOOD_TEXT_LENGTH}
              required
              disabled={saving}
              value={text}
              onChange={change(setText)}
              className={cn(FIELD_INPUT, "md:min-w-[16em]")}
            />
          </Field>
          <Field id="user_mood_clear_at" label="Clear at">
            <select
              id="user_mood_clear_at"
              disabled={saving}
              value={clearAt}
              onChange={choose}
              aria-describedby="user-mood-clear-at-note"
              className={cn(SELECT, "md:w-[10em]")}
            >
              {CLEAR_CHOICES.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p id="user-mood-clear-at-note" className={NOTE}>
              When it comes off by itself. Never keeps it until you take it off.
            </p>
          </Field>
        </div>
        <div className="flex flex-col gap-2 md:flex-row-reverse md:items-start">
          <SubmitButton disabled={!typed || saving} className="md:w-auto md:px-[3ch]">
            Save mood
          </SubmitButton>
          <Button
            type="button"
            variant="outline"
            onClick={clear}
            disabled={mood === null || saving}
            className="h-auto min-h-[42px] w-full rounded-[9px] px-4 py-2.5 text-sm font-[550] touch:min-h-11 md:w-auto md:px-[3ch]"
          >
            Clear
          </Button>
        </div>
      </form>
    </section>
  );
}
