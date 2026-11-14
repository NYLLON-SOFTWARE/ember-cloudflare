import { useState } from "react";
import { guestSignInLink, type RoomGuest, type RoomId, type RoomPerson, type UserId } from "@ember/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FIELD_INPUT } from "@/components/field";
import { Hourglass, Xmark } from "@/components/icons/iconoir";
import { useMounted } from "@/hooks/use-mounted";
import { addGuest, endGuest, extendGuest } from "@/lib/api";
import { NOTE, SELECT } from "./model-picker";

// The guests panel of a room's settings, for whoever can change the room: the room's guests, each with
// when their stay ends, a way to extend or end it, and the form that adds a guest. A guest is in this
// room and nothing else, and signs in with just their name, until the stay picked here ends. Boxed as
// the room's other panels are.

/** The picker's value for "Custom…", whose time is picked in a field of its own. */
const CUSTOM = "";

/** The picker's value before a span is picked, which changes nothing. */
const NOTHING = "";

/** An ISO time `ms` from `now`. */
const aheadOf = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/** The spans a stay can be picked from, each with the time it ends, the way Do not disturb picks its own. */
const SPANS: Array<{ label: string; untilOf: (now: Date) => string }> = [
  { label: "24 hours", untilOf: (now) => aheadOf(now, 24 * 60 * 60_000) },
  { label: "A week", untilOf: (now) => aheadOf(now, 7 * 24 * 60 * 60_000) },
  { label: "30 days", untilOf: (now) => aheadOf(now, 30 * 24 * 60 * 60_000) },
];

/** How a stay's end reads, as this device shows times. */
const UNTIL_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** The span a picker at `value` picks, or null while it's "Custom…" with no time typed, or before one is. */
function spanUntil(value: string, custom: string): string | null {
  if (value === CUSTOM) return custom === "" ? null : new Date(custom).toISOString();
  return SPANS.find(({ label }) => label === value)?.untilOf(new Date()) ?? null;
}

interface Props {
  roomId: RoomId;
  /** The room's guests, as its settings' people list marks them. */
  guests: RoomPerson[];
  /** Marks a guest as its stay's answer named them, adding one who isn't listed yet. */
  onSaved: (guest: RoomGuest) => void;
  /** Stops marking a guest whose stay has ended, which takes them out of the list once it's heard of. */
  onEnded: (userId: UserId) => void;
  /** Says why something couldn't be saved, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** A room's guests: each one's stay, extending or ending it, and the form that adds a guest. */
export function RoomGuests({ roomId, guests, onSaved, onEnded, onFailed }: Props) {
  /** What the add form's fields hold, the name as the guest will sign in with it. */
  const [name, setName] = useState("");
  const [picked, setPicked] = useState("");
  /** What the add form's custom field holds, as a date-time field gives it. */
  const [custom, setCustom] = useState("");
  /** What each guest's own picker holds, and the custom time it may open, by their id. */
  const [extendsPicked, setExtendsPicked] = useState<Record<UserId, string>>({});
  const [extendsCustom, setExtendsCustom] = useState<Record<UserId, string>>({});
  /** What's on its way, so no two of a row's changes are sent at once: "add", or "extend:<id>", or "end:<id>". */
  const [busy, setBusy] = useState<string | null>(null);
  const mounted = useMounted();

  const send = (what: string, go: () => Promise<void>) => {
    setBusy(what);
    go().then(
      () => {
        if (mounted.current) setBusy(null);
      },
      (error: unknown) => {
        if (mounted.current) setBusy(null);
        onFailed(error);
      },
    );
  };

  /** Adds a guest for the span picked, or for a day while none is, or "Custom…" is picked but empty. */
  const add = (until: string) =>
    send("add", async () => {
      const guest = await addGuest(roomId, name.trim(), until);
      onSaved(guest);
      setName("");
      setPicked("");
      setCustom("");
    });

  /** Adds them for the span picked, as the form asks. */
  const submit = () => add(spanUntil(picked, custom) ?? aheadOf(new Date(), 24 * 60 * 60_000));

  /** Picks the span the form adds a guest for. */
  const pick = (value: string) => setPicked(value);

  /** Picks the custom field's time, as it's typed whole, which the form then adds them until. */
  const pickCustom = (value: string) => setCustom(value);

  /** Extends a guest's stay for the span their picker picks, or opens the custom field for "Custom…". */
  const pickExtend = (userId: UserId, value: string) => {
    setExtendsPicked((picked) => ({ ...picked, [userId]: value }));
    if (value === CUSTOM) return;
    const until = spanUntil(value, "");
    if (until !== null) extend(userId, until);
  };

  /** Picks a guest's custom field's time, which extends their stay until it, as it's typed whole. */
  const pickExtendCustom = (userId: UserId, value: string) => {
    setExtendsCustom((custom) => ({ ...custom, [userId]: value }));
    const at = value === "" ? null : new Date(value);
    if (at !== null && !Number.isNaN(at.getTime())) extend(userId, at.toISOString());
  };

  const extend = (userId: UserId, until: string) =>
    send(`extend:${userId}`, async () => onSaved(await extendGuest(roomId, userId, until)));

  const end = (userId: UserId) =>
    send(`end:${userId}`, async () => {
      await endGuest(roomId, userId);
      onEnded(userId);
    });

  return (
    <section aria-labelledby="guests-heading" className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
      <h2 id="guests-heading" className="flex items-center gap-2 text-base font-semibold">
        <Hourglass className="size-4" />
        Guests
      </h2>
      <p>A guest is in this room and nothing else, and signs in with just their name, until the stay you pick ends.</p>
      {guests.length > 0 && (
        <ul className="flex flex-col gap-3" data-testid="guest-list">
          {guests.map((guest) => {
            const extending = busy === `extend:${guest.id}`;
            return (
              <li key={guest.id} className="flex flex-col gap-1.5" data-user-id={guest.id}>
                <div className="flex items-center gap-2">
                  <Hourglass className="size-[1.1em] shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-[550]">{guest.name}</span>
                  <span className="text-sm text-muted-foreground">Guest until {UNTIL_FORMAT.format(new Date(guest.guestUntil!))}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`extend_${guest.id}`} className="sr-only">
                    Extend {guest.name}'s stay
                  </label>
                  <select
                    id={`extend_${guest.id}`}
                    value={extendsPicked[guest.id] ?? NOTHING}
                    disabled={extending}
                    onChange={(event) => pickExtend(guest.id, event.target.value)}
                    className={SELECT}
                  >
                    <option value={NOTHING}>Extend…</option>
                    {SPANS.map(({ label }) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                    <option value={CUSTOM}>Custom…</option>
                  </select>
                  {extendsPicked[guest.id] === CUSTOM && (
                    <Input
                      id={`extend_custom_${guest.id}`}
                      type="datetime-local"
                      aria-label={`Extend ${guest.name}'s stay until a time of your own`}
                      value={extendsCustom[guest.id] ?? ""}
                      disabled={extending}
                      onChange={(event) => pickExtendCustom(guest.id, event.target.value)}
                      className={FIELD_INPUT}
                    />
                  )}
                </div>
                <Button type="button" variant="outline" disabled={busy === `end:${guest.id}`} onClick={() => end(guest.id)} className="max-w-full touch:h-11">
                  <Xmark className="size-[1.3em] shrink-0" />
                  <span className="truncate">End {guest.name}'s stay</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor="guest_name" className="text-sm font-[550]">
          Add a guest
        </label>
        <Input
          id="guest_name"
          type="text"
          required
          maxLength={48}
          placeholder="Their name"
          value={name}
          disabled={busy === "add"}
          onChange={(event) => setName(event.target.value)}
          className={FIELD_INPUT}
        />
        <label htmlFor="guest_until" className="text-sm font-[550]">
          Their stay ends
        </label>
        <select id="guest_until" value={picked} disabled={busy === "add"} onChange={(event) => pick(event.target.value)} className={SELECT}>
          <option value={NOTHING}>Pick a span…</option>
          {SPANS.map(({ label }) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
          <option value={CUSTOM}>Custom…</option>
        </select>
        {picked === CUSTOM && (
          <Input
            id="guest_custom_until"
            type="datetime-local"
            aria-label="Until a time of your own"
            value={custom}
            disabled={busy === "add"}
            onChange={(event) => pickCustom(event.target.value)}
            className={FIELD_INPUT}
          />
        )}
        <p id="guest_until_note" className={NOTE}>
          The guest signs in with just the name you give them, and stops at their stay's end. Send them to{" "}
          {guestSignInLink(location.origin)} to sign in with it.
        </p>
        <Button type="submit" disabled={busy === "add" || name.trim() === ""} className="h-[42px] rounded-[9px] font-[550] touch:h-11">
          Add guest
        </Button>
      </form>
    </section>
  );
}
