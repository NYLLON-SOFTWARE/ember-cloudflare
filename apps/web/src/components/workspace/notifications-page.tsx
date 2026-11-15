import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { NOTIFICATION_LEVELS, startingInvolvement, type Involvement, type Me, type NotificationLevel, type NotificationSettings, type RoomId, type SidebarRoom } from "@ember/protocol";
import { NavArrowDown } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { BackButton } from "@/components/mobile/back-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNameOf } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { PROFILE_PATH } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeNotifications, fetchNotificationSettings, isSignedOut, resetNotificationLevels, setInvolvement } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { LEVEL_NAMES } from "@/lib/involvement";
import type { RoomAnswer } from "@/lib/room-list";
import { sendTimeInSentence, tomorrowMorning } from "@/lib/schedule-times";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { PageHeader } from "./page-header";
import { RoomMark } from "./search-box";
import { SearchField } from "./search-field";
import { TimeDialog } from "./time-dialog";

/** What each default says it notifies you about, as Slack's "Notify me about" does. */
export const NOTIFICATION_LEVEL_LABELS: Record<NotificationLevel, string> = {
  everything: "All new messages",
  mentions: "DMs, mentions and threads I follow",
  nothing: "Nothing",
};

const ROOM_CHOICES: Involvement[] = ["everything", "mentions", "nothing", "invisible"];
const DIRECT_CHOICES: Involvement[] = ["everything", "nothing"];

/** How long each of the pause menu's choices pauses notifications for, from now. */
const PAUSES: Array<{ label: string; until: (now: Date) => number }> = [
  { label: "30 minutes", until: (now) => now.getTime() + 30 * 60 * 1000 },
  { label: "1 hour", until: (now) => now.getTime() + 60 * 60 * 1000 },
  { label: "Until tomorrow", until: (now) => tomorrowMorning(now).getTime() },
];

/** The longest a timer waits, as browsers count it; a longer pause is looked at again then. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** A `.btn`, 36px tall, or a fingertip's 44px on touch screens. */
const BUTTON = "inline-flex h-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] border bg-background px-3 text-sm font-medium hover:bg-hover touch:h-11";

interface Props {
  me: Me;
  /** Your rooms and DMs, as the sidebar's list has them, levels and all. */
  rooms: SidebarRoom[] | null;
  /** Called as a level is saved, with what gives the room the level the server answers. */
  askForRoom: () => (answer: RoomAnswer) => void;
  onFailed: (error: unknown) => void;
}

/**
 * Preferences › Notifications, after Slack's: what you're notified about wherever you haven't picked a
 * level, pausing notifications for a while, and every room and DM you're in with its level, to change,
 * to set back to the default, or all of them at once. A pause stops pushes, not what the app shows. It's
 * asked for again as the tab shows or takes focus, as another tab may have changed it.
 */
export function NotificationsPage({ me, rooms, askForRoom, onFailed }: Props) {
  useTitle("Notifications");
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const mounted = useMounted();
  const phone = usePhoneLayout();
  const load = useEffectEvent(() =>
    fetchNotificationSettings().then(
      (loaded) => mounted.current && setSettings(loaded),
      (error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error),
    ),
  );
  useEffect(() => {
    void load();
    const again = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, []);

  const save = async (saving: Promise<NotificationSettings>) => {
    try {
      const saved = await saving;
      if (mounted.current) setSettings(saved);
    } catch (error) {
      if (mounted.current || isSignedOut(error)) onFailed(error);
    }
  };
  // The level picked shows at once, and goes back to what it was if it couldn't be saved.
  const changeLevel = (level: NotificationLevel) => {
    const before = settings?.level;
    setSettings((shown) => shown && { ...shown, level });
    void changeNotifications({ level }).then(
      (saved) => mounted.current && setSettings(saved),
      (error: unknown) => {
        if (mounted.current) setSettings((shown) => (shown && before !== undefined ? { ...shown, level: before } : shown));
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };

  return (
    <>
      <PageHeader back={PROFILE_PATH}>
        {/* Back to your profile, where it's opened from, on a desktop too. */}
        {!phone && <BackButton fallback={PROFILE_PATH} label="Back to your profile" className="-ml-2.5" />}
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-center max-md:font-bold">Notifications</h1>
        <span aria-hidden="true" className="hidden w-11 shrink-0 max-md:block" />
      </PageHeader>
      <MainContent className="min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        {settings && (
          <div className="mx-auto flex max-w-[640px] flex-col gap-8 px-[22px] pt-6 pb-[max(24px,env(safe-area-inset-bottom))] max-md:px-4">
            <DefaultLevel level={settings.level} onChange={changeLevel} />
            <Pause pausedUntil={settings.pausedUntil} onChange={(pausedUntil) => void save(changeNotifications({ pausedUntil }))} />
            {rooms && (
              <RoomLevels
                me={me}
                rooms={rooms}
                settings={settings}
                onChosen={(chosen) => setSettings((shown) => shown && { ...shown, chosen })}
                onResetAll={() => void save(resetNotificationLevels())}
                askForRoom={askForRoom}
                onFailed={onFailed}
              />
            )}
          </div>
        )}
      </MainContent>
    </>
  );
}

/** "Notify me about": one of the levels, as radio buttons, each row a fingertip's 48px on a phone, in 16px type. */
function DefaultLevel({ level, onChange }: { level: NotificationLevel; onChange: (level: NotificationLevel) => void }) {
  return (
    <fieldset className="flex flex-col">
      <legend className="mb-2 text-base font-semibold">Notify me about</legend>
      {NOTIFICATION_LEVELS.map((choice) => (
        <label key={choice} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] max-md:min-h-12 max-md:text-base">
          <input type="radio" name="notification-level" checked={level === choice} onChange={() => onChange(choice)} className="size-4 shrink-0 accent-foreground max-md:size-5" />
          {NOTIFICATION_LEVEL_LABELS[choice]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Pause notifications, one row: Pause at its end, which pauses them for a while or until a time picked,
 * or while they're paused, until when, and Resume. It says they're back as the pause ends.
 */
function Pause({ pausedUntil, onChange }: { pausedUntil: number | null; onChange: (pausedUntil: number | null) => void }) {
  const [picking, setPicking] = useState(false);
  // Counts the pause's end coming, so the row says notifications are back without asking the server.
  const [, setEnded] = useState(0);
  const now = new Date();
  const paused = pausedUntil !== null && pausedUntil > now.getTime();
  useEffect(() => {
    if (pausedUntil === null || pausedUntil <= Date.now()) return;
    const timer = setTimeout(() => setEnded((ended) => ended + 1), Math.min(pausedUntil - Date.now(), LONGEST_TIMER_MS));
    return () => clearTimeout(timer);
  });
  return (
    <section aria-labelledby="pause-heading" className="flex min-h-11 items-center gap-3">
      {paused ? (
        <>
          <h2 id="pause-heading" className="sr-only">
            Pause notifications
          </h2>
          <p role="status" className="min-w-0 flex-1 text-[15px] max-md:text-base">
            Paused until {sendTimeInSentence(pausedUntil, now)}
          </p>
          <button type="button" onClick={() => onChange(null)} className={BUTTON}>
            Resume
          </button>
        </>
      ) : (
        <>
          <h2 id="pause-heading" className="min-w-0 flex-1 text-base font-semibold">
            Pause notifications
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger className={BUTTON}>Pause</DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {PAUSES.map(({ label, until }) => (
                <DropdownMenuItem key={label} onSelect={() => onChange(until(new Date()))}>
                  {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onSelect={() => setPicking(true)}>Custom…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      {picking && (
        <TimeDialog
          title="Pause notifications until"
          action="Pause"
          initial={new Date(now.getTime() + 60 * 60 * 1000)}
          onClose={() => setPicking(false)}
          onPick={(at) => {
            setPicking(false);
            onChange(at.getTime());
          }}
        />
      )}
    </section>
  );
}

interface RoomLevelsProps {
  me: Me;
  rooms: SidebarRoom[];
  settings: NotificationSettings;
  onChosen: (chosen: RoomId[]) => void;
  onResetAll: () => void;
  askForRoom: () => (answer: RoomAnswer) => void;
  onFailed: (error: unknown) => void;
}

/**
 * Every room you're in, by the name it's shown by, then every DM, each a row that opens a picker of its
 * level, the browser's own, which a pick saves: Default follows what you're notified about. A row says
 * its level at its end, muted while it follows the default. A search narrows them by name, and Reset all,
 * once asked, has all but the rooms you've hidden follow it again.
 */
function RoomLevels({ me, rooms, settings, onChosen, onResetAll, askForRoom, onFailed }: RoomLevelsProps) {
  const nameOf = useNameOf();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const chosen = useMemo(() => new Set(settings.chosen), [settings.chosen]);
  const named = useMemo(() => {
    const listed = rooms.map((room) => ({ room, name: roomName(room, me.id, nameOf) }));
    // Sub-rooms go by their parents' names, as they're shown.
    const shared = listed.filter(({ room }) => room.kind !== "direct").sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || (a.room.id < b.room.id ? -1 : 1));
    return [...shared, ...listed.filter(({ room }) => room.kind === "direct")];
  }, [rooms, me.id, nameOf]);
  const wanted = query.trim().toLocaleLowerCase();
  const shown = wanted ? named.filter(({ name }) => name.toLocaleLowerCase().includes(wanted)) : named;
  const resettable = rooms.some((room) => chosen.has(room.id) && room.involvement !== "invisible");

  const pick = async (room: SidebarRoom, involvement: Involvement | "default") => {
    const answered = askForRoom();
    try {
      const saved = await setInvolvement(room.id, involvement);
      answered({ type: "involved", roomId: room.id, involvement: saved });
      onChosen(involvement === "default" ? settings.chosen.filter((id) => id !== room.id) : [...new Set([...settings.chosen, room.id])]);
    } catch (error) {
      onFailed(error);
    }
  };

  return (
    <section aria-labelledby="rooms-heading" className="flex flex-col gap-3">
      <div className="flex min-h-9 items-center gap-3">
        <h2 id="rooms-heading" className="min-w-0 flex-1 text-base font-semibold">
          Rooms and DMs
        </h2>
        {resettable && (
          <button type="button" onClick={() => setConfirming(true)} className={BUTTON}>
            Reset all
          </button>
        )}
      </div>
      <SearchField value={query} onChange={setQuery} placeholder="Find a room or DM" label="Find a room or DM" />
      {shown.length === 0 && wanted ? (
        <p className="py-6 text-center text-[15px] text-muted-foreground">No rooms or DMs match</p>
      ) : (
        <ul className="flex flex-col">
          {shown.map(({ room, name }) => {
            const own = chosen.has(room.id);
            return (
              <li
                key={room.id}
                className="relative flex min-h-12 items-center gap-3 border-b px-1 last:border-b-0 hover:bg-hover has-[select:focus-visible]:outline-2 has-[select:focus-visible]:outline-foreground"
              >
                <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
                  <RoomMark room={room} size={18} />
                </span>
                <span className={cn("min-w-0 flex-1 truncate text-[15px] max-md:text-base", room.involvement === "invisible" && "text-muted-foreground")}>{name}</span>
                <span aria-hidden="true" className={cn("shrink-0 text-sm max-md:text-[15px]", own ? "text-foreground" : "text-muted-foreground")}>
                  {LEVEL_NAMES[room.involvement]}
                </span>
                <NavArrowDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                {/* The whole row opens the picker, the browser's own, which a phone shows as its own sheet. */}
                <select
                  aria-label={`Notifications for ${name}`}
                  value={own ? room.involvement : "default"}
                  onChange={(event) => void pick(room, event.target.value as Involvement | "default")}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                >
                  <option value="default">Default ({LEVEL_NAMES[startingInvolvement(room, settings.level)]})</option>
                  {(room.kind === "direct" ? DIRECT_CHOICES : ROOM_CHOICES).map((choice) => (
                    <option key={choice} value={choice}>
                      {LEVEL_NAMES[choice]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
      {confirming && (
        <ConfirmDialog
          title="Reset every room and DM to the default?"
          confirm="Reset all"
          onConfirm={() => {
            setConfirming(false);
            onResetAll();
          }}
          onCancel={() => setConfirming(false)}
        >
          Rooms you&rsquo;ve hidden stay hidden.
        </ConfirmDialog>
      )}
    </section>
  );
}
