import { useContext, useEffect, useState, type ReactNode } from "react";
import type { Me, Person, User, UserId } from "@ember/protocol";
import { ChatLines, ClockRotateRight, Headset, Mail, Xmark } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { personPath } from "@/hooks/use-route";
import { fetchPerson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentBadge, isAgent } from "./agent-badge";
import { SideColumnSeparator } from "./side-column";
import { UserAvatar } from "./user-avatar";

import { type ProfilePane } from "./profile-pane";

// Someone's profile in a pane, which loads with the pages few visits need (pages.ts).

interface Props {
  userId: UserId;
  me: Me;
  pane: ProfilePane;
  /** Where it goes: the column beside a room, which a separator sizes, or one of Activity's panes. */
  placement: "column" | "pane";
}

/** What a button in the pane looks like: Slack's outlined buttons, 36px tall, 44px for fingers. */
const PANE_BUTTON =
  "inline-flex min-h-9 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold hover:bg-hover aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent touch:min-h-11";

/**
 * Someone's profile in a pane: Profile and Close over their photo, name, what they say about themselves,
 * whether they're away for good, their local time, Message and Huddle, and how to reach them.
 */
export function ProfilePanel({ userId, me, pane, placement }: Props) {
  const listed = useContext(PeopleContext).get(userId);
  const [fetched, setFetched] = useState<{ userId: UserId; person: Person } | null>(null);
  const [failed, setFailed] = useState<UserId | null>(null);
  const [starting, setStarting] = useState(false);
  const { huddles } = useAccount();

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
        <div className="flex flex-col gap-5 overflow-y-auto px-6 py-6 max-md:px-4">
          <div className="mx-auto w-full max-w-[280px]">
            <UserAvatar user={person} square label={`${person.name}’s photo`} className="aspect-square size-full rounded-xl text-[4rem]" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-[22px] leading-tight font-bold wrap-anywhere">{person.name}</h2>
            {isAgent(person) && <AgentBadge />}
            {person.bio && <p className="text-[15px] text-foreground/90 wrap-anywhere">{person.bio}</p>}
            {!active && <p className="text-sm text-muted-foreground">{statusLabel(person.status)}</p>}
            {person.timeZone && <LocalTime timeZone={person.timeZone} />}
          </div>
          {active && !mine && (
            <div className="flex gap-2">
              <button type="button" aria-disabled={starting || undefined} onClick={startDirect} className={PANE_BUTTON}>
                <ChatLines className="size-[18px]" />
                Message
              </button>
              {huddles && (
                // Huddles happen in rooms, which a DM isn't, so this says where to start one.
                <button type="button" aria-disabled title="Huddles happen in rooms: start one from a room you’re both in" className={PANE_BUTTON}>
                  <Headset className="size-[18px]" />
                  Huddle
                </button>
              )}
            </div>
          )}
          <ContactInformation person={person} />
        </div>
      ) : (
        <p className="p-6 text-sm text-muted-foreground" aria-busy={failed !== userId}>
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

/** Their time where they are, as their browser last said, kept current to the minute. */
function LocalTime({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);
  let time: string;
  try {
    time = now.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
  return (
    <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
      <ClockRotateRight className="size-4" />
      <span>{time} local time</span>
    </p>
  );
}

/** Their email address, which only administrators are told, and their full page. */
function ContactInformation({ person }: { person: Partial<Person> & User }) {
  return (
    <section aria-labelledby="profile-contact" className="flex flex-col gap-3 border-t pt-5">
      <h3 id="profile-contact" className="text-[15px] font-bold">
        Contact information
      </h3>
      {person.emailAddress && (
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
            <Mail className="size-[18px]" />
          </span>
          <div className="min-w-0 text-sm">
            <div className="text-muted-foreground">Email address</div>
            <a href={`mailto:${person.emailAddress}`} className="text-link wrap-anywhere hover:underline">
              {person.emailAddress}
            </a>
          </div>
        </div>
      )}
      {/* The full page, which this pane leaves links to it for: not a link the pane opens itself. */}
      <PageLink href={personPath(person.id)} data-full-page className="text-sm text-link hover:underline">
        View full profile
      </PageLink>
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
      <header className="flex min-h-header shrink-0 items-center gap-2 border-b py-2.5 pr-3.5 pl-5 max-md:min-h-[calc(56px+env(safe-area-inset-top))] max-md:pt-[env(safe-area-inset-top)]">
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
