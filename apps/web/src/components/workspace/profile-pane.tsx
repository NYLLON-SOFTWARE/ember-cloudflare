import { createContext, useContext, useEffect, useLayoutEffect, useState, type MouseEvent, type ReactNode } from "react";
import type { Me, Person, User, UserId } from "@ember/protocol";
import { ChatLines, ClockRotateRight, Copy, Headset, Mail, MoreHoriz, User as UserIcon, Xmark } from "@/components/icons/iconoir";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { navigate, personPath } from "@/hooks/use-route";
import { useShownPresence } from "@/hooks/use-shown-presence";
import { fetchPerson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentBadge, isAgent } from "./agent-badge";
import { SideColumnSeparator } from "./side-column";
import { UserAvatar } from "./user-avatar";

// Someone's profile beside the conversation shown, as Slack opens one from an avatar or a name: in the
// column beside a room, in a thread's place when one is open there, or in Activity's last pane. Their page,
// `/users/<id>`, stays for links to it.

export interface ProfilePane {
  /** Whose profile is open beside the conversation shown, or null. */
  userId: UserId | null;
  /** Opens someone's profile beside the conversation shown, in the place of anyone else's. */
  open: (userId: UserId) => void;
  close: () => void;
  /** Starts a DM with someone, or opens the one you have, and goes there, settling with whether it did. */
  startDirect: (person: User) => Promise<boolean>;
}

/** What the address of a room or Activity names the person whose profile is open beside it by: `?profile=<id>`. */
export const PROFILE_PARAM = "profile";

/** The profile pane of the page shown, or null on a page that has none, where an avatar links to someone's page. */
export const ProfilePaneContext = createContext<ProfilePane | null>(null);

export const useProfilePane = () => useContext(ProfilePaneContext);

/** The person a link's address names, when it's someone's page. */
export function personOfLink(link: HTMLAnchorElement): UserId | null {
  if (link.origin !== location.origin) return null;
  const match = link.pathname.match(/^\/users\/([^/]+)$/);
  if (!match || match[1] === "me") return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Opens the profile pane in place of following a link to someone's page that `event`'s click is on, as
 * Slack's avatars and names do, when there's a pane to open it in, and the link is followed in place.
 */
export function opensProfile(pane: ProfilePane | null, event: MouseEvent): void {
  if (!pane || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("data-full-page")) return;
  const userId = personOfLink(link);
  if (userId === null) return;
  event.preventDefault();
  opener = link;
  pane.open(userId);
}

/** The link the profile pane opened from last, for focus to return to as it closes. */
let opener: Element | null = null;

/**
 * Puts focus back where it was as a pane opened, once it's closed, or where it opened from, or failing
 * those on the page's content, unless something else has taken focus meanwhile.
 */
function useFocusReturn(): void {
  useLayoutEffect(() => {
    const focused = document.activeElement === document.body ? null : document.activeElement;
    const from = opener;
    opener = null;
    return () => {
      // Once the pane has gone, which takes focus with it from anything in it.
      setTimeout(() => {
        if (document.activeElement && document.activeElement !== document.body) return;
        for (const candidate of [focused, from, from?.closest("article"), document.querySelector("main")]) {
          if (!(candidate instanceof HTMLElement) || !candidate.isConnected) continue;
          candidate.focus();
          if (document.activeElement === candidate) return;
        }
      });
    };
  }, []);
}

interface Props {
  userId: UserId;
  me: Me;
  pane: ProfilePane;
  /** Where it goes: the column beside a room, which a separator sizes, or one of Activity's panes. */
  placement: "column" | "pane";
}

/** One of the row of actions, as Slack's profile has them: an icon over a short label, in a tile. */
const ACTION_TILE =
  "flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-hover px-2 py-2.5 text-[13px] font-semibold hover:bg-border aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-hover data-[state=open]:bg-border";

/**
 * Someone's profile in a pane: Profile and Close over their photo, name, what they say about themselves,
 * whether they're here or away for good, their local time, a row of actions, and how to reach them.
 */
export function ProfilePanel({ userId, me, pane, placement }: Props) {
  const listed = useContext(PeopleContext).get(userId);
  const [fetched, setFetched] = useState<{ userId: UserId; person: Person } | null>(null);
  const [failed, setFailed] = useState<UserId | null>(null);
  const [starting, setStarting] = useState(false);
  const { huddles } = useAccount();
  const here = useShownPresence().has(userId);

  useEffect(() => {
    let stopped = false;
    fetchPerson(userId).then(
      (answer) => !stopped && setFetched({ userId, person: answer.person }),
      () => !stopped && setFailed(userId),
    );
    return () => void (stopped = true);
  }, [userId]);

  const person: (Partial<Person> & User) | null = fetched?.userId === userId ? { ...fetched.person, ...listed } : (listed ?? null);
  const mine = userId === me.id;
  const active = (person?.status ?? "active") === "active";
  const startDirect = async () => {
    if (!person || starting) return;
    setStarting(true);
    try {
      await pane.startDirect(person);
    } finally {
      setStarting(false);
    }
  };

  return (
    <PaneFrame placement={placement} label="Profile" onClose={pane.close}>
      {person ? (
        <div className="flex flex-col gap-5 overflow-y-auto px-5 py-6 max-md:px-4">
          <div className="w-full max-w-[320px]">
            <UserAvatar user={person} square label={`${person.name}’s photo`} className="aspect-square size-full rounded-xl text-[4rem]" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-[22px] leading-tight font-bold wrap-anywhere">{person.name}</h2>
            {isAgent(person) && <AgentBadge />}
            {person.bio && <p className="text-[15px] text-foreground/90 wrap-anywhere">{person.bio}</p>}
            {!active ? (
              <p className="text-sm text-muted-foreground">{statusLabel(person.status)}</p>
            ) : (
              // Ember knows who's here room by room, so this says only who's in the room shown.
              here && (
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <span aria-hidden="true" className="size-2.5 rounded-full bg-positive" />
                  Active
                </p>
              )
            )}
            {person.timeZone && <LocalTime timeZone={person.timeZone} />}
          </div>
          <div className="flex gap-2">
            {active && !mine && (
              <button type="button" aria-disabled={starting || undefined} onClick={startDirect} className={ACTION_TILE}>
                <ChatLines className="size-5" />
                Message
              </button>
            )}
            {active && !mine && huddles && (
              // Huddles happen in rooms, which a DM isn't, so this says where to start one.
              <button type="button" aria-disabled title="Start a huddle from a room you’re both in" className={ACTION_TILE}>
                <Headset className="size-5" />
                Huddle
              </button>
            )}
            <MoreActions person={person} />
          </div>
          {person.emailAddress && <ContactInformation emailAddress={person.emailAddress} />}
        </div>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground max-md:px-4" aria-busy={failed !== userId}>
          {failed === userId ? "This person couldn’t be loaded." : "Loading…"}
        </p>
      )}
    </PaneFrame>
  );
}

function statusLabel(status: Person["status"] | undefined): string {
  if (status === "banned") return "Banned";
  if (status === "suspended") return "Membership lapsed";
  return "No longer on this account";
}

/**
 * The time in `timeZone`, as "2:51 AM", kept current to the minute, or null without a time zone or with
 * one this browser doesn't know.
 */
export function useLocalTime(timeZone: string | null | undefined): string | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!timeZone) return;
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [timeZone]);
  if (!timeZone) return null;
  try {
    return now.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
}

/** Their time where they are, as their browser last said, kept current to the minute. */
export function LocalTime({ timeZone }: { timeZone: string }) {
  const time = useLocalTime(timeZone);
  if (time === null) return null;
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <ClockRotateRight className="size-4" />
      <span>{time} local time</span>
    </p>
  );
}

/** ⋯: their full page, and copying their id, as Slack's profile's menu has them. */
function MoreActions({ person }: { person: User }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="More actions" className={cn(ACTION_TILE, "max-w-20")}>
        <MoreHoriz className="size-5" />
        More
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => navigate(personPath(person.id))}>
          <UserIcon />
          View full profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(person.id).catch(() => {})}>
          <Copy />
          Copy member ID
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Their email address, which only administrators are told: under a heading, by a boxed envelope over what
 * it is, as Slack's desktop profile has it, and on phones, as its app does, a bare envelope and the link.
 */
function ContactInformation({ emailAddress }: { emailAddress: string }) {
  return (
    <section aria-labelledby="profile-contact" className="flex flex-col gap-3 border-t pt-5 max-md:pt-4">
      <h3 id="profile-contact" className="text-[15px] font-bold max-md:sr-only">
        Contact information
      </h3>
      <div className="flex items-center gap-3 max-md:gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover max-md:size-auto max-md:bg-transparent max-md:text-muted-foreground">
          <Mail className="size-[18px]" />
        </span>
        <div className="min-w-0 text-sm">
          <div className="text-muted-foreground max-md:sr-only">Email address</div>
          <a href={`mailto:${emailAddress}`} className="text-link wrap-anywhere hover:underline">
            {emailAddress}
          </a>
        </div>
      </div>
    </section>
  );
}

interface FrameProps {
  placement: "column" | "pane";
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A pane's frame: its title and Close, over what it holds. Beside a room it's the column a thread has,
 * marked for the page's grid to give it its place, and over the thread when one's open there, with the
 * separator that sizes it.
 */
export function PaneFrame({ placement, label, onClose, children }: FrameProps) {
  useFocusReturn();
  return (
    <aside
      aria-label={label}
      data-thread={placement === "column" || undefined}
      data-profile={placement === "column" || undefined}
      data-side-column={placement === "column" || undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-background",
        placement === "column"
          ? "absolute inset-0 z-10 col-start-3 row-span-2 row-start-1 pr-[env(safe-area-inset-right)] max-md:col-start-1 max-md:pl-[env(safe-area-inset-left)] min-[1180px]:relative min-[1180px]:col-start-4 min-[1180px]:border-l"
          : "h-full",
      )}
    >
      {placement === "column" && <SideColumnSeparator label={`Resize ${label.toLowerCase()}`} />}
      <header className="flex min-h-header shrink-0 items-center gap-2 border-b py-2.5 pr-3.5 pl-5 max-md:pl-4 max-md:min-h-[calc(56px+env(safe-area-inset-top))] max-md:pt-[env(safe-area-inset-top)]">
        <h2 className="text-[17px] leading-[1.4] font-[650]">{label}</h2>
        <button
          type="button"
          title={`Close ${label.toLowerCase()}`}
          aria-label={`Close ${label.toLowerCase()}`}
          onClick={onClose}
          className="ml-auto grid size-9 shrink-0 place-items-center rounded-[10px] text-foreground hover:bg-hover touch:size-11"
        >
          <Xmark className="size-5" />
        </button>
      </header>
      {children}
    </aside>
  );
}
