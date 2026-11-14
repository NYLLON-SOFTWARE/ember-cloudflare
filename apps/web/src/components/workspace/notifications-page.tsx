import { useEffect, useMemo, useState } from "react";
import { NOTIFICATION_LEVELS, startingInvolvement, type Involvement, type Me, type NotificationLevel, type NotificationSettings, type RoomId, type SidebarRoom } from "@ember/protocol";
import { MainContent } from "@/components/main-content";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useNameOf } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { useTitle } from "@/hooks/use-title";
import { changeNotifications, fetchNotificationSettings, isSignedOut, resetNotificationLevels, setInvolvement } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { profileOrder } from "@/lib/involvement";
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

/** Each level as a room's list names it, shorter. */
const LEVEL_NAMES: Record<Involvement, string> = { everything: "All messages", mentions: "Mentions", nothing: "Nothing", invisible: "Hidden" };

const ROOM_CHOICES: Involvement[] = ["everything", "mentions", "nothing", "invisible"];
const DIRECT_CHOICES: Involvement[] = ["everything", "nothing"];

/** How long each of the pause menu's choices pauses notifications for, from now. */
const PAUSES: Array<{ label: string; until: (now: Date) => number }> = [
  { label: "30 minutes", until: (now) => now.getTime() + 30 * 60 * 1000 },
  { label: "1 hour", until: (now) => now.getTime() + 60 * 60 * 1000 },
  { label: "Until tomorrow", until: (now) => tomorrowMorning(now).getTime() },
];

const BUTTON = "inline-flex cursor-pointer items-center justify-center rounded-[9px] border bg-background px-3 py-1.5 text-sm font-medium hover:bg-hover touch:min-h-11";

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
 * to set back to the default, or all of them at once. A pause stops pushes, not what the app shows.
 */
export function NotificationsPage({ me, rooms, askForRoom, onFailed }: Props) {
  useTitle("Notifications");
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const mounted = useMounted();
  useEffect(() => {
    fetchNotificationSettings().then(
      (loaded) => mounted.current && setSettings(loaded),
      (error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error),
    );
  }, [mounted, onFailed]);

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
        if (mounted.current) setSettings((shown) => shown && before !== undefined ? { ...shown, level: before } : shown);
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };

  return (
    <>
      <PageHeader back="/">
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

/** "Notify me about": one of the levels, as radio buttons. */
function DefaultLevel({ level, onChange }: { level: NotificationLevel; onChange: (level: NotificationLevel) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-2 text-base font-semibold">Notify me about</legend>
      {NOTIFICATION_LEVELS.map((choice) => (
        <label key={choice} className="flex cursor-pointer items-center gap-3 py-1.5 text-[15px] touch:min-h-11">
          <input type="radio" name="notification-level" checked={level === choice} onChange={() => onChange(choice)} className="size-4 accent-foreground" />
          {NOTIFICATION_LEVEL_LABELS[choice]}
        </label>
      ))}
    </fieldset>
  );
}

/** Pause notifications, for a while or until a time picked, or, while they're paused, until when, and Resume. */
function Pause({ pausedUntil, onChange }: { pausedUntil: number | null; onChange: (pausedUntil: number | null) => void }) {
  const [picking, setPicking] = useState(false);
  const now = new Date();
  // A pause that's ended is over, though the page hasn't asked since.
  const paused = pausedUntil !== null && pausedUntil > now.getTime();
  return (
    <section aria-labelledby="pause-heading" className="flex flex-col gap-2">
      <h2 id="pause-heading" className="text-base font-semibold">
        Pause notifications
      </h2>
      {paused ? (
        <p className="flex flex-wrap items-center gap-3 text-[15px]">
          <span role="status">Paused until {sendTimeInSentence(pausedUntil, now)}</span>
          <button type="button" onClick={() => onChange(null)} className={BUTTON}>
            Resume
          </button>
        </p>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(BUTTON, "self-start")}>Pause</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {PAUSES.map(({ label, until }) => (
              <DropdownMenuItem key={label} onSelect={() => onChange(until(new Date()))}>
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => setPicking(true)}>Custom…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
 * Every room you're in, then every DM, each with its level, which a pick saves: Default follows what you're
 * notified about. A search narrows them by name, and Reset all, once asked, has all but the rooms you've
 * hidden follow it again.
 */
function RoomLevels({ me, rooms, settings, onChosen, onResetAll, askForRoom, onFailed }: RoomLevelsProps) {
  const nameOf = useNameOf();
  const [query, setQuery] = useState("");
  const [confirming, setConfirming] = useState(false);
  const chosen = useMemo(() => new Set(settings.chosen), [settings.chosen]);
  const listed = useMemo(() => {
    const { shared, directs } = profileOrder(rooms);
    const wanted = query.trim().toLocaleLowerCase();
    return [...shared, ...directs]
      .map((room) => ({ room, name: roomName(room, me.id, nameOf) }))
      .filter(({ name }) => name.toLocaleLowerCase().includes(wanted));
  }, [rooms, query, me.id, nameOf]);
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
      <div className="flex items-center gap-3">
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
      <ul className="flex flex-col">
        {listed.map(({ room, name }) => (
          <li key={room.id} className="flex min-h-12 items-center gap-3 border-b py-1.5 last:border-b-0">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] bg-surface text-muted-foreground">
              <RoomMark room={room} size={16} />
            </span>
            <span className={cn("min-w-0 flex-1 truncate text-[15px]", room.involvement === "invisible" && "text-muted-foreground")}>{name}</span>
            <select
              aria-label={`Notifications for ${name}`}
              value={chosen.has(room.id) ? room.involvement : "default"}
              onChange={(event) => void pick(room, event.target.value as Involvement | "default")}
              className="h-9 shrink-0 cursor-pointer rounded-[9px] border bg-background px-2 text-sm touch:h-11 touch:text-base"
            >
              <option value="default">Default ({LEVEL_NAMES[startingInvolvement(room, settings.level)]})</option>
              {(room.kind === "direct" ? DIRECT_CHOICES : ROOM_CHOICES).map((choice) => (
                <option key={choice} value={choice}>
                  {LEVEL_NAMES[choice]}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {confirming && (
        <ConfirmDialog
          title="Reset every room to the default?"
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
