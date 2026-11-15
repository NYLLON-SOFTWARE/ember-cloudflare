import { useContext, useEffect, useState, type ReactNode } from "react";
import { Page } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { SEARCHES_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { NavigationIcon } from "../workspace/navigation-icon";
import { OpenSearchContext, opensSearch } from "../workspace/search-box";
import { TAB_PATHS, type Tab } from "./tabs";
import "./mobile.css";
import "./tab-bar.css";

/** The tabs' icons and Search's, all one size. */
const ICON_SIZE = 22;
const ICON = "size-[22px]";

/** What's waiting on each tab, which a dot at its icon's corner marks. */
export type TabNotices = Partial<Record<Tab, string>>;

interface Props {
  /** The tab marked: the page's own, or the one the page shown was opened from. */
  current: Tab;
  notices: TabNotices;
  /** The room shown, which Search starts in, as a room's own Search does, or null. */
  roomId: string | null;
}

/**
 * The phone layout's tab bar, Slack's: Home, DMs, Activity and Files in a pill along the bottom of the
 * screen, the marked one highlighted, and Search, which opens the search box, in a circle of its own
 * beside them, in the room shown when there is one, as far from the screen's edge as the floating New
 * direct message button over it. A tab with something waiting has a dot at its icon's corner, said to
 * screen readers as a description. It floats over a tab's page (tab-bar.css), makes way for the
 * on-screen keyboard, and on a short screen, such as a small phone's or one on its side, which has little
 * height to spare, shows its icons alone.
 */
export function TabBar({ current, notices, roomId }: Props) {
  const openSearch = useContext(OpenSearchContext);
  const typing = useTyping();
  // The page knows too, so what else makes way for the keyboard, such as a room's tabs, can (mobile.css).
  useEffect(() => {
    document.documentElement.toggleAttribute("data-typing", typing);
    return () => document.documentElement.removeAttribute("data-typing");
  }, [typing]);
  return (
    <nav aria-label="Tabs" data-tab-bar data-typing={typing || undefined} className="relative z-[3] col-start-1 row-[-2/-1] data-typing:hidden md:hidden">
      <div className="flex items-center gap-2 bg-background pt-1.5 pr-[max(16px,env(safe-area-inset-right))] pb-[max(8px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] [@media(height<37.5rem)]:pt-1">
        <div className="flex min-w-0 flex-1 items-center rounded-full border bg-surface p-1 shadow-[0_2px_12px_var(--color-drag-shadow)]">
          <TabLink tab="home" label="Home" current={current} notice={notices.home} icon={<NavigationIcon slot="home" size={ICON_SIZE} className={ICON} />} />
          <TabLink tab="dms" label="DMs" current={current} notice={notices.dms} icon={<NavigationIcon slot="dms" size={ICON_SIZE} className={ICON} />} />
          <TabLink tab="activity" label="Activity" current={current} notice={notices.activity} icon={<NavigationIcon slot="activity" size={ICON_SIZE} className={ICON} />} />
          <TabLink tab="files" label="Files" current={current} notice={notices.files} icon={<Page className={ICON} />} />
        </div>
        <PageLink
          href={SEARCHES_PATH}
          aria-label="Search"
          onClick={opensSearch(openSearch, roomId === null ? {} : { roomId })}
          className="grid size-14 shrink-0 place-items-center rounded-full border bg-surface shadow-[0_2px_12px_var(--color-drag-shadow)] [@media(height<37.5rem)]:size-12"
        >
          <NavigationIcon slot="search" size={ICON_SIZE} className={ICON} />
        </PageLink>
      </div>
    </nav>
  );
}

interface TabLinkProps {
  tab: Tab;
  label: string;
  current: Tab;
  notice: string | undefined;
  icon: ReactNode;
}

/** One of the tabs: its icon over its name, highlighted while it's marked, with a dot when something's waiting. */
function TabLink({ tab, label, current, notice, icon }: TabLinkProps) {
  return (
    <PageLink
      href={TAB_PATHS[tab]}
      aria-current={tab === current ? "page" : undefined}
      aria-description={notice}
      className={cn(
        "relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 text-[11px] leading-[14px] font-medium text-muted-foreground",
        "aria-[current=page]:bg-hover aria-[current=page]:text-foreground [@media(height<37.5rem)]:min-h-11",
      )}
    >
      <span className="relative">
        {icon}
        {notice && <span aria-hidden="true" className="absolute -top-0.5 -right-1.5 size-[9px] rounded-full border-2 border-surface bg-foreground" />}
      </span>
      <span className="max-w-full truncate [@media(height<37.5rem)]:sr-only">{label}</span>
    </PageLink>
  );
}

/** A field that brings up the on-screen keyboard. */
const TEXT_FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="file"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"]), textarea, [contenteditable="true"]';

/** How long the tab bar waits to come back once a field's lost focus, as the keyboard takes a moment to go. */
const KEYBOARD_GOING_MS = 400;

/**
 * Whether a text field has focus, so the on-screen keyboard is up, and for a moment after it loses
 * focus: a tap that takes focus from it, as on a Save button or a person in the @ list, then lands where
 * it was aimed, rather than where the tab bar coming back moves things to.
 */
function useTyping(): boolean {
  const [typing, setTyping] = useState(() => document.activeElement?.matches(TEXT_FIELD) ?? false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(timer);
      if (document.activeElement?.matches(TEXT_FIELD)) setTyping(true);
      else timer = setTimeout(() => setTyping(document.activeElement?.matches(TEXT_FIELD) ?? false), KEYBOARD_GOING_MS);
    };
    document.addEventListener("focusin", changed);
    document.addEventListener("focusout", changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", changed);
      document.removeEventListener("focusout", changed);
    };
  }, []);
  return typing;
}
