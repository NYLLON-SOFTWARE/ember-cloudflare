import { useContext, type MouseEvent } from "react";
import type { Me, NavigationSlot } from "@ember/protocol";
import { PageLink } from "@/components/page-link";
import { useAccount } from "@/hooks/use-account";
import { ACTIVITY_PATH, DMS_PATH, PROFILE_PATH, SEARCHES_PATH, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { unreadBadge } from "@/lib/unread-badge";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "./appearance-menu";
import { FilesRailLink } from "./files-rail-link";
import { NavigationIcon } from "./navigation-icon";
import { OpenSearchContext, opensSearch } from "./search-box";
import { UserAvatar } from "./user-avatar";

const RAIL_LINK = cn(
  "relative flex size-14 shrink-0 flex-col items-center justify-center gap-[5px] rounded-[10px] px-[3px] py-1.5 text-[11px] text-muted-foreground",
  "hover:bg-hover hover:text-foreground aria-[current=page]:bg-hover aria-[current=page]:text-foreground",
);

/** The ink pill at a rail item's corner that counts what's unread there, as Activity's does. */
const COUNT_BADGE =
  "absolute top-px right-[5px] inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-[12px] border-2 border-surface bg-foreground px-[3px] text-[10px] leading-none font-semibold text-background";

interface RailLinkProps {
  slot: NavigationSlot;
  label: string;
  href: string;
  current: boolean;
  /** What a dot at the icon's corner says is waiting there, said to screen readers as a description. */
  notice?: string;
  /** How many are unread there, counted in a pill at the icon's corner up to 9+, hidden at none. */
  unread?: number;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * One of the rail's links, marked when it's the page shown, with a dot in ink when something's waiting
 * there, or a count of what's unread, said to screen readers as a description, as Activity's is.
 */
function RailLink({ slot, label, href, current, notice, unread = 0, onClick }: RailLinkProps) {
  const description = unread > 0 ? `${unreadBadge(unread)} unread` : notice;
  return (
    <PageLink href={href} aria-current={current ? "page" : undefined} aria-description={description} onClick={onClick} className={RAIL_LINK}>
      <NavigationIcon slot={slot} size={22} className="size-[22px]" />
      <span>{label}</span>
      {unread > 0 ? (
        <span aria-hidden="true" className={COUNT_BADGE}>
          {unreadBadge(unread)}
        </span>
      ) : (
        notice && <span aria-hidden="true" className="absolute top-[5px] right-[13px] size-[11px] rounded-full border-2 border-surface bg-foreground" />
      )}
    </PageLink>
  );
}

/** Activity, as the rail shows it: how many of its items are unread. */
export interface Activity {
  unread: number;
}

/**
 * Activity, the page of what's happened to you, with how many of its items are unread in an ink pill at
 * its corner, hidden at none, "99+" past 99. The count is said to screen readers as a description, so the
 * link's name stays "Activity".
 */
function ActivityLink({ unread, current }: Activity & { current: boolean }) {
  return (
    <PageLink
      href={ACTIVITY_PATH}
      aria-current={current ? "page" : undefined}
      aria-description={unread > 0 ? `${unreadBadge(unread)} unread` : undefined}
      className={RAIL_LINK}
    >
      <NavigationIcon slot="activity" size={22} className="size-[22px]" />
      <span>Activity</span>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className={COUNT_BADGE}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </PageLink>
  );
}

/**
 * The page shown, whose links the rail marks: every link to the page's own path (the logo and Home at
 * home, Activity on Activity, Search on search, whatever's searched for, Admin or Workspace on workspace
 * settings, your avatar on your profile), Home on a room's page, DMs on the DMs page and a DM's, and
 * Files on the Files page.
 */
export type RailPage = "home" | "room" | "dms" | "activity" | "search" | "workspace" | "profile" | "files" | null;

interface Props {
  me: Me;
  /** The workspace's name, which the logo's tooltip shows. */
  workspaceName: string;
  current: RailPage;
  activity: Activity;
  /** How many unread messages the DMs have, which DMs counts, as Slack's does. */
  directsUnread: number;
  /** The release of Ember out since this one, such as "0.2", which Admin marks for an administrator, or null for none. */
  newRelease: string | null;
}

/**
 * The persistent navigation rail, drawn with the icons an administrator chose in Community settings, or
 * else with Iconoir's, as the project's owner chose. Admin has a dot while a newer release of Ember is
 * out, which General, where it goes, tells of.
 */
export function Rail({ me, workspaceName, current, activity, directsUnread, newRelease }: Props) {
  const { logo } = useAccount();
  const openSearch = useContext(OpenSearchContext);
  const marked = current;
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
        {/* The logo, or the flame, fills the 56px square, its corners rounded, on no background of its own. */}
        {logo ? (
          <img src={logo} alt="" width={56} height={56} className="size-14 rounded-[inherit] object-cover" />
        ) : (
          <img src="/ember-icon.png" alt="" width={56} height={56} className="size-14 rounded-[inherit] object-contain" />
        )}
      </PageLink>
      <RailLink slot="home" label="Home" href="/" current={marked === "home" || marked === "room"} />
      <RailLink slot="dms" label="DMs" href={DMS_PATH} current={marked === "dms"} unread={directsUnread} />
      <ActivityLink unread={activity.unread} current={marked === "activity"} />
      <FilesRailLink current={marked === "files"} className={RAIL_LINK} />
      {/* Opens the search box in place, for everything. */}
      <RailLink slot="search" label="Search" href={SEARCHES_PATH} current={marked === "search"} onClick={opensSearch(openSearch)} />
      <hr className="my-1 w-8 border-t" />
      <RailLink
        slot="admin"
        label={me.administrator ? "Admin" : "Workspace"}
        href={WORKSPACE_SETTINGS_PATH}
        current={marked === "workspace"}
        notice={newRelease === null ? undefined : `Ember ${newRelease} is available`}
      />
      <AppearanceMenu />
      {/* Your avatar, at 36px, links to your profile, where you log out. */}
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
