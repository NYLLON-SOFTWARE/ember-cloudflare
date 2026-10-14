import type { ComponentType } from "react";
import type { Me } from "@ember/protocol";
import { Logout } from "@/components/icons/campfire";
import { Bell, Home, Messages, Search, Settings } from "@/components/icons/ember";
import { PageLink } from "@/components/page-link";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { leave, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "./appearance-menu";
import { UserAvatar } from "./user-avatar";

const RAIL_LINK = cn(
  "relative flex size-14 shrink-0 flex-col items-center justify-center gap-[5px] rounded-[10px] px-[3px] py-1.5 text-[11px] text-muted-foreground",
  "hover:bg-hover hover:text-foreground aria-[current=page]:bg-hover aria-[current=page]:text-foreground",
);

type Icon = ComponentType<{ className?: string }>;

/** One of the rail's links, marked when it's the page shown. */
function RailLink({ icon: Icon, label, href, current }: { icon: Icon; label: string; href: string; current: boolean }) {
  return (
    <PageLink href={href} aria-current={current ? "page" : undefined} className={RAIL_LINK}>
      <Icon className="size-[22px]" />
      <span>{label}</span>
    </PageLink>
  );
}

/** A place on the rail that isn't built yet, which says so. */
function UnbuiltRailLink({ icon: Icon, label }: { icon: Icon; label: string }) {
  return (
    <button type="button" disabled title={`${label} isn't built yet`} className={cn(RAIL_LINK, "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground")}>
      <Icon className="size-[22px]" />
      <span>{label}</span>
    </button>
  );
}

/**
 * The page shown, whose links the rail marks as ember-rust's shell.js does: every link to the page's
 * own path (the logo and Home at home, Admin or Workspace on workspace settings), and Home on a room's page.
 */
export type RailPage = "home" | "room" | "workspace" | null;

interface Props {
  me: Me;
  /** The workspace's name, which the logo's tooltip shows. */
  workspaceName: string;
  current: RailPage;
  onSignOut: () => Promise<boolean>;
}

/** The persistent navigation rail from ember-rust's layouts/application.html. */
export function Rail({ me, workspaceName, current, onSignOut }: Props) {
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
        aria-current={current === "home" ? "page" : undefined}
        className="mb-1 flex size-11 shrink-0 items-center justify-center"
      >
        <img src="/ember-icon.png" alt="" width={44} height={44} className="size-11 object-contain" />
      </PageLink>
      <RailLink icon={Home} label="Home" href="/" current={current === "home" || current === "room"} />
      <UnbuiltRailLink icon={Messages} label="DMs" />
      <UnbuiltRailLink icon={Bell} label="Activity" />
      <UnbuiltRailLink icon={Search} label="Search" />
      <hr className="my-1 w-8 border-t" />
      <RailLink icon={Settings} label={me.administrator ? "Admin" : "Workspace"} href={WORKSPACE_SETTINGS_PATH} current={current === "workspace"} />
      <AppearanceMenu />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Your profile" title={me.name} className="shrink-0 rounded-full touch:p-1">
          <UserAvatar user={me} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-48 rounded-xl p-2">
          <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* A form with unsaved changes asks first, as ember-rust's settings.js asks before another form is sent. */}
          <DropdownMenuItem onSelect={() => leave(onSignOut)}>
            <Logout className="size-[18px]" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
