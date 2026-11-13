import { useState } from "react";
import { HalfMoon } from "@/components/icons/iconoir";
import { useMounted } from "@/hooks/use-mounted";
import { clearDnd, isSignedOut, setDnd } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { FIELD_INPUT } from "@/components/field";
import { Switch } from "@/components/ui/switch";
import { NOTE, SELECT } from "./model-picker";

// The Do not disturb section of your profile: a switch that hushes your push notifications until a
// time you pick, and the picker of times. It hushes push notifications alone: your rooms, unread
// marks, the app badge and banners in the app carry on. A change saves at once, and shows as it was
// again if it isn't saved. Boxed as the Ember AI section is.

/** The picker's value for "Custom…", whose time is picked in a field of its own. */
const CUSTOM = "";

/** The picker's value when nothing is picked yet, which hushes for an hour. */
const ONE_HOUR = "1 hour";

/** An ISO time `ms` from `now`. */
const aheadOf = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/** Today at five in the evening, or null once it's past. */
function thisEvening(now: Date): string | null {
  const five = new Date(now);
  five.setHours(17, 0, 0, 0);
  return five > now ? five.toISOString() : null;
}

/** Tomorrow at nine in the morning. */
function tomorrowMorning(now: Date): string {
  const nine = new Date(now);
  nine.setDate(nine.getDate() + 1);
  nine.setHours(9, 0, 0, 0);
  return nine.toISOString();
}

/** The quick picks of when a hush ends, each with the time it hushes until, or null once it has passed. */
const SPANS: Array<{ label: string; untilOf: (now: Date) => string | null }> = [
  { label: "20 minutes", untilOf: (now) => aheadOf(now, 20 * 60_000) },
  { label: "1 hour", untilOf: (now) => aheadOf(now, 3_600_000) },
  { label: "4 hours", untilOf: (now) => aheadOf(now, 4 * 3_600_000) },
  { label: "This evening", untilOf: thisEvening },
  { label: "Tomorrow morning", untilOf: tomorrowMorning },
];

/** How a hush's end reads, as this device shows times. */
const UNTIL_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

interface Props {
  /** When your push notifications are hushed until, or null while they aren't. */
  dndUntil: string | null;
  /** Shows your push notifications as a change here saves them, or as they were again when it isn't. */
  onChanged: (dndUntil: string | null) => void;
  /** Says why a change couldn't be saved, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** Your hush of push notifications: the switch, and the picker of when it ends. */
export function DoNotDisturb({ dndUntil, onChanged, onFailed }: Props) {
  const [picked, setPicked] = useState(ONE_HOUR);
  /** What the custom field holds, as a date-time field gives it, in this device's time. */
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();
  const hushing = dndUntil !== null;

  /** When the picked span hushes until, or null while it's "Custom…" and no time is picked in its field yet. */
  const spanUntil = (label: string, now: Date) => {
    if (label === CUSTOM) return custom === "" ? null : new Date(custom).toISOString();
    return SPANS.find(({ label: at }) => at === label)?.untilOf(now) ?? aheadOf(now, 3_600_000);
  };

  const save = (until: string | null) => {
    const was = dndUntil;
    setSaving(true);
    onChanged(until);
    (until === null ? clearDnd() : setDnd(until)).then(
      ({ dndUntil }) => {
        if (!mounted.current) return;
        setSaving(false);
        onChanged(dndUntil);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onChanged(was);
        onFailed(error);
      },
    );
  };

  /** Hushes for the picked span, or for an hour while "Custom…" is picked but empty. */
  const hush = () => save(spanUntil(picked, new Date()) ?? aheadOf(new Date(), 3_600_000));

  /** Picks a span, which hushes at once for it, or opens the custom field for "Custom…". */
  const pick = (label: string) => {
    setPicked(label);
    if (label === CUSTOM) return;
    const until = spanUntil(label, new Date());
    if (until !== null) save(until);
  };

  /** Picks the custom field's time, which hushes until it, as it's typed whole. */
  const pickCustom = (value: string) => {
    setCustom(value);
    // From the time typed, not the field's state, which this change hasn't settled into yet.
    const at = value === "" ? null : new Date(value);
    if (at !== null && !Number.isNaN(at.getTime())) save(at.toISOString());
  };

  return (
    <section aria-labelledby="do-not-disturb-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="do-not-disturb-heading" className="flex items-center gap-2 text-base font-semibold">
        <HalfMoon className="size-4" />
        Do not disturb
      </h2>
      <p>Hushes your push notifications until a time you pick. Your rooms, unread marks, the app badge and banners in the app carry on.</p>
      <div className="flex items-center gap-3">
        <Switch id="do_not_disturb" checked={hushing} disabled={saving} onCheckedChange={(checked) => (checked ? hush() : save(null))} />
        <label htmlFor="do_not_disturb" className="text-sm font-[550]">
          Hush my push notifications
        </label>
      </div>
      <div className="flex max-w-[24em] flex-col gap-1.5">
        <label htmlFor="dnd_until" className="text-sm font-[550]">
          Until
        </label>
        <select id="dnd_until" value={picked} disabled={saving} onChange={(event) => pick(event.target.value)} className={SELECT}>
          {SPANS.map(({ label, untilOf }) => (
            <option key={label} value={label} disabled={untilOf(new Date()) === null}>
              {label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {picked === CUSTOM && (
          // Named apart from the picker's "Until", which this field sits under.
          <Input
            id="dnd_custom_until"
            type="datetime-local"
            aria-label="Until a time of your own"
            value={custom}
            disabled={saving}
            onChange={(event) => pickCustom(event.target.value)}
            className={FIELD_INPUT}
          />
        )}
        {hushing && (
          <p id="dnd_until_note" className={NOTE}>
            Push notifications are hushed until {UNTIL_FORMAT.format(new Date(dndUntil!))}.
          </p>
        )}
      </div>
    </section>
  );
}
