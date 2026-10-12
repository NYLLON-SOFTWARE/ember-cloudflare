import type { ComponentType, ReactNode } from "react";
import type { User } from "@ember/protocol";
import { Bell, House, LogOut, MessagesSquare, Search, Settings } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "./appearance-menu";
import { UserAvatar } from "./user-avatar";

function RailLink({ icon: Icon, label, current, disabled, children }: { icon: ComponentType<{ className?: string }>; label: string; current?: boolean; disabled?: boolean; children?: ReactNode }) {
  return (
    <button
      type="button"
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      title={disabled ? `${label} isn't built yet` : label}
      className={cn(
        "relative flex size-14 shrink-0 flex-col items-center justify-center gap-[5px] rounded-[10px] px-[3px] py-1.5 text-[11px] text-muted-foreground",
        "hover:bg-hover hover:text-foreground aria-[current=page]:bg-hover aria-[current=page]:text-foreground",
        "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground",
      )}
    >
      <Icon className="size-[22px]" />
      <span>{label}</span>
      {children}
    </button>
  );
}

/** The persistent navigation rail from ember-rust's layouts/application.html. */
export function Rail({ me, onSignOut }: { me: User; onSignOut: () => void }) {
  return (
    <nav aria-label="Workspace" className="flex h-full w-rail flex-col items-center gap-3 border-r bg-surface px-3 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <a href="/" aria-label="Ember home" className="mb-1 flex size-11 shrink-0 items-center justify-center">
        <img src="/ember-icon.png" alt="" width={44} height={44} className="size-11 object-contain" />
      </a>
      <RailLink icon={House} label="Home" current />
      <RailLink icon={MessagesSquare} label="DMs" disabled />
      <RailLink icon={Bell} label="Activity" disabled />
      <RailLink icon={Search} label="Search" disabled />
      <hr className="my-1 w-8 border-t" />
      <RailLink icon={Settings} label="Workspace" disabled />
      <AppearanceMenu />
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Your profile" title={me.name} className="rounded-full">
          <UserAvatar user={me} />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-48 rounded-xl p-2">
          <DropdownMenuLabel className="truncate">{me.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
