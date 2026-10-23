import type { MouseEvent } from "react";
import type { Me, NavigationSlot } from "@ember/protocol";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { NEW_DIRECT_PATH, PROFILE_PATH, SEARCHES_PATH, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "./appearance-menu";
import { NavigationIcon } from "./navigation-icon";
import { opensNewDirect } from "./new-direct-dialog";
import { UserAvatar } from "./user-avatar";

const RAIL_LINK = cn(
  "relative flex size-14 shrink-0 flex-col items-center justify-center gap-[5px] rounded-[10px] px-[3px] py-1.5 text-[11px] text-muted-foreground",
  "hover:bg-hover hover:text-foreground aria-[current=page]:bg-hover aria-[current=page]:text-foreground",
);

interface RailLinkProps {
  slot: NavigationSlot;
  label: string;
  href: string;
  current: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** One of the rail's links, marked when it's the page shown. */
function RailLink({ slot, label, href, current, onClick }: RailLinkProps) {
  return (
    <PageLink href={href} aria-current={current ? "page" : undefined} onClick={onClick} className={RAIL_LINK}>
      <NavigationIcon slot={slot} size={22} className="size-[22px]" />
      <span>{label}</span>
    </PageLink>
  );
}

/** The Activity filter: whether it's on, and how many conversations are unread. */
export interface Activity {
  on: boolean;
  unread: number;
  onToggle: () => void;
}

/**
 * Activity, which shows only unread conversations while it's pressed, with how many there are in an
 * ink pill at its corner, as ember-rust's `.mb-activity-count` (zz-ember.css), hidden at none. The
 * count is said to screen readers as a description, so the button's name stays "Activity".
 */
function ActivityButton({ on, unread, onToggle }: Activity) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-description={unread > 0 ? `${unread} unread` : undefined}
      title="Show unread conversations"
      onClick={onToggle}
      className={cn(RAIL_LINK, "aria-pressed:bg-hover aria-pressed:text-foreground")}
    >
      <NavigationIcon slot="activity" size={22} className="size-[22px]" />
      <span>Activity</span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-px right-[5px] inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[12px] border-2 border-surface bg-foreground px-[3px] text-[10px] leading-none font-semibold text-background"
        >
          {unread}
        </span>
      )}
    </button>
  );
}

/**
 * The page shown, whose links the rail marks as ember-rust's shell.js does: every link to the page's
 * own path (the logo and Home at home, Search on search, whatever's searched for, Admin or Workspace on
 * workspace settings, your avatar on your profile), and Home on a room's page, but none while Activity is on.
 */
export type RailPage = "home" | "room" | "search" | "workspace" | "profile" | null;

interface Props {
  me: Me;
  /** The workspace's name, which the logo's tooltip shows. */
  workspaceName: string;
  current: RailPage;
  activity: Activity;
  /** Opens New direct message, which DMs does in place, from the link that opened it. */
  onNewDirect: (opener: HTMLElement) => void;
}

/**
 * The persistent navigation rail from ember-rust's layouts/application.html, drawn with the icons an
 * administrator chose in Community settings, as ember-rust's pull request #24 has it, or else with
 * Iconoir's rather than ember-rust's, as the project's owner chose.
 */
export function Rail({ me, workspaceName, current, activity, onNewDirect }: Props) {
  const { logo } = useAccount();
  const marked = activity.on ? null : current;
  return (
    // Scrolls when a short screen (a phone in landscape) can't fit it all; widens by the notch's inset.
    <nav
      aria-label="Workspace"
      className="flex h-full w-[calc(var(--spacing-rail)+env(safe-area-inset-left))] flex-col items-center gap-3 overflow-y-auto overscroll-contain border-r bg-surface pt-4 pr-3 pb-[max(16px,env(safe-area-inset-bottom))] pl-[calc(12px+env(safe-area-inset-left))] [scrollbar-width:none]"
    >
      <PageLink
        href="/"
        aria-label="Ember home"
        title={workspaceName}
        aria-current={marked === "home" ? "page" : undefined}
        className="mb-1 flex size-14 shrink-0 items-center justify-center rounded-[10px]"
      >
        {/* The logo, or the flame, fills the 56px square, its corners rounded, on no background of its own, as
            ember-rust's `.mb-rail__brand` draws it since its pull request #24. */}
        {logo ? (
          <img src={logo} alt="" width={56} height={56} className="size-14 rounded-[inherit] object-cover" />
        ) : (
          <img src="/ember-icon.png" alt="" width={56} height={56} className="size-14 rounded-[inherit] object-contain" />
        )}
      </PageLink>
      <RailLink slot="home" label="Home" href="/" current={marked === "home" || marked === "room"} />
      {/* Never marked, since its address opens New direct message over the last room visited. */}
      <RailLink slot="dms" label="DMs" href={NEW_DIRECT_PATH} current={false} onClick={opensNewDirect(onNewDirect)} />
      <ActivityButton {...activity} />
      <RailLink slot="search" label="Search" href={SEARCHES_PATH} current={marked === "search"} />
      <hr className="my-1 w-8 border-t" />
      <RailLink slot="admin" label={me.administrator ? "Admin" : "Workspace"} href={WORKSPACE_SETTINGS_PATH} current={marked === "workspace"} />
      <AppearanceMenu />
      {/* ember-rust's `.mb-rail__profile`: your avatar, at 36px, links to your profile, where you log out. */}
      <PageLink
        href={PROFILE_PATH}
        aria-label="Your profile"
        title={me.name}
        aria-current={marked === "profile" ? "page" : undefined}
        className="flex shrink-0 rounded-full touch:p-1"
      >
        <UserAvatar user={me} />
      </PageLink>
    </nav>
  );
}
