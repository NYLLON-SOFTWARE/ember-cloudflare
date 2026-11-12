import { useRef, useState, type ReactNode } from "react";
import type { Person } from "@ember/protocol";
import { useOptionalFlash } from "@/components/flash";
import { ChatLines, Copy, Headset, Link, MoreHoriz } from "@/components/icons/iconoir";
import { Mail, Prohibition } from "@/components/icons/iconoir-more";
import { MainContent } from "@/components/main-content";
import { useAccount } from "@/hooks/use-account";
import { useLocalTime } from "@/hooks/use-local-time";
import { useShownPresence } from "@/hooks/use-shown-presence";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "../workspace/confirm-dialog";
import { PageHeader } from "../workspace/page-header";
import { SignInLink } from "../workspace/sign-in-link";
import { UserAvatar } from "../workspace/user-avatar";
import { ActionSheet, BottomSheet, type SheetAction } from "./action-sheet";
import { BackButton } from "./back-button";

interface Props {
  /** Where Back goes when the app didn't open the page. */
  back: string;
  /** Who it's for, or null while they load. */
  person: Person | null;
  /** What the top bar ends with, such as Edit my profile on your own. */
  links?: ReactNode;
  /** Their name and what else the page says of them, under their picture. */
  children: ReactNode;
}

/**
 * Someone's profile on a phone, Slack's: Back and "Profile" at the top, their picture the width of the
 * screen, dimmed under a cancel mark while they're banned, and under it, from the left, their name and
 * what else their page says.
 */
export function PhoneProfile({ back, person, links, children }: Props) {
  const banned = person?.status === "banned";
  return (
    <>
      <PageHeader>
        <BackButton fallback={back} />
        <p className="min-w-0 flex-1 truncate text-center text-[17px] leading-6 font-bold">Profile</p>
        {/* As wide as Back, so Profile stays in the middle. */}
        <div className="flex min-w-11 shrink-0 justify-end">{links}</div>
      </PageHeader>
      <MainContent
        aria-busy={person === null}
        className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] pb-6 pl-[env(safe-area-inset-left)]"
      >
        {person && (
          <div className="mx-auto max-w-[480px] px-4 pt-4">
            <div className="relative">
              <UserAvatar user={person} label="Profile avatar" square className={cn("aspect-square h-auto w-full rounded-2xl", banned && "opacity-50")} />
              {banned && <Prohibition className="absolute inset-0 m-auto size-1/2" />}
            </div>
            <div className="mt-4 text-start wrap-anywhere [&_h1]:text-[26px]">{children}</div>
          </div>
        )}
      </MainContent>
    </>
  );
}

/** One of the row of actions, as the profile pane's: an icon over a short label, in a tile. */
const ACTION_TILE =
  "flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-xl bg-hover px-2 py-2.5 text-[13px] font-semibold hover:bg-border aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-hover data-[state=open]:bg-border";

/** Where huddles start, which a DM isn't. */
const HUDDLE_FROM_ROOM = "Start a huddle from a room you’re both in";

interface AboutProps {
  /** Someone active, banned, or suspended, whom only administrators see so. */
  person: Person;
  /** Whether it's your own page. */
  mine: boolean;
  administrator: boolean;
  /** The id in a new sign-in link for them, which administrators are given for anyone active. */
  transferId?: string;
  /** Whether Message is starting the DM, which a second tap doesn't start again. */
  starting: boolean;
  /** Starts a DM with them, or opens yours. */
  onMessage: () => void;
  /** Bans them, or lifts their ban, without asking, as Ban's dialog has. */
  onToggleBan: () => void;
}

/** Which of More's sheets, or Ban's question, is open. */
type Shown = "more" | "signIn" | "ban" | null;

/**
 * What a phone's profile says of a person, as Slack's app does, under their picture: their name, then
 * whether they're here and their time where they are, a row of Message, Huddle while huddles are on, and
 * More, their bio, and their email address for administrators. More holds Copy member ID, and for
 * administrators, their sign-in link and Ban, or Remove ban, which ask first.
 */
export function PhoneAbout({ person, mine, administrator, transferId, starting, onMessage, onToggleBan }: AboutProps) {
  const { huddles } = useAccount();
  const flash = useOptionalFlash();
  const [shown, setShown] = useState<Shown>(null);
  // What's chosen in More opens once the sheet has gone, as an open sheet keeps focus in itself.
  const next = useRef<Shown>(null);
  const more = useRef<HTMLButtonElement>(null);
  const active = person.status === "active";
  const banned = person.status === "banned";

  const focusMore = () => more.current?.focus({ preventScroll: true });
  const afterClosing = (sheet: Shown) => () => (next.current = sheet);
  const closed = (event: Event) => {
    event.preventDefault();
    const then = next.current;
    next.current = null;
    if (then) setShown(then);
    else focusMore();
  };
  const close = (open: boolean) => open || setShown(null);

  const copyId = () => {
    void navigator.clipboard?.writeText(person.id).then(
      () => flash?.("notice", "Member ID copied"),
      () => {},
    );
  };

  const ban = (sure: boolean) => {
    setShown(null);
    if (sure) onToggleBan();
  };

  const actions: SheetAction[] = [{ label: "Copy member ID", icon: <Copy className="size-5" />, onSelect: copyId }];
  if (administrator && transferId) actions.push({ label: "Auto-login link", icon: <Link className="size-5" />, onSelect: afterClosing("signIn") });
  const admin: SheetAction[] =
    administrator && !mine
      ? [
          banned
            ? { label: "Remove ban", icon: <Prohibition className="size-5" />, onSelect: afterClosing("ban") }
            : { label: "Ban", icon: <Prohibition className="size-5" />, negative: true, onSelect: afterClosing("ban") },
        ]
      : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="leading-[1.2] font-bold">{person.name}</h1>
        <StatusLine person={person} />
      </div>
      <div className="flex gap-2">
        {active && !mine && (
          <button type="button" aria-disabled={starting || undefined} onClick={onMessage} className={ACTION_TILE}>
            <ChatLines className="size-5" />
            Message
          </button>
        )}
        {active && !mine && huddles && (
          // Huddles happen in rooms, which a DM isn't, so a tap says where to start one.
          <button type="button" aria-disabled title={HUDDLE_FROM_ROOM} onClick={() => flash?.("notice", HUDDLE_FROM_ROOM)} className={ACTION_TILE}>
            <Headset className="size-5" />
            Huddle
          </button>
        )}
        <button ref={more} type="button" aria-label="More actions" aria-haspopup="dialog" onClick={() => setShown("more")} className={cn(ACTION_TILE, "max-w-20")}>
          <MoreHoriz className="size-5" />
          More
        </button>
      </div>
      {person.bio && <p className="text-[17px] leading-[1.4]">{person.bio}</p>}
      {person.emailAddress && (
        <a href={`mailto:${person.emailAddress}`} className="flex min-h-11 items-center gap-2.5 text-link">
          <Mail className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="min-w-0">{person.emailAddress}</span>
        </a>
      )}
      <ActionSheet open={shown === "more"} onOpenChange={close} title="More actions" titleHidden onCloseAutoFocus={closed} actions={actions} more={admin} />
      {transferId && (
        <BottomSheet open={shown === "signIn"} onOpenChange={close} title="Auto-login link" onCloseAutoFocus={closed}>
          <div className="px-2">
            <SignInLink transferId={transferId} mine={mine} />
          </div>
        </BottomSheet>
      )}
      {shown === "ban" &&
        (banned ? (
          <ConfirmDialog title={`Remove the ban on ${person.name}`} confirm="Remove ban" onConfirm={() => ban(true)} onCancel={() => ban(false)} onClosed={focusMore} />
        ) : (
          <ConfirmDialog title={`Ban ${person.name}`} confirm="Ban" destructive onConfirm={() => ban(true)} onCancel={() => ban(false)} onClosed={focusMore}>
            This signs them out, deletes their messages and blocks their IP addresses.
          </ConfirmDialog>
        ))}
    </div>
  );
}

/**
 * Whether they're here, as the room shown says, or banned, or their membership's lapsed, then their time
 * where they are, on one line, or nothing when the page knows neither.
 */
function StatusLine({ person }: { person: Person }) {
  const here = useShownPresence().has(person.id);
  const time = useLocalTime(person.timeZone);
  const status = person.status === "banned" ? "Banned" : person.status === "suspended" ? "Membership lapsed" : null;
  if (!status && !here && !time) return null;
  return (
    <p className="text-[15px] text-muted-foreground">
      {here && (
        <span className="text-foreground">
          <span aria-hidden="true" className="me-1.5 inline-block size-2.5 rounded-full bg-positive" />
          Active
        </span>
      )}
      {status}
      {(here || status) && time && " · "}
      {time && <span className="whitespace-nowrap">{time} local time</span>}
    </p>
  );
}
