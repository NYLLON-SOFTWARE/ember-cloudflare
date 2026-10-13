import type { User } from "@ember/protocol";
import { Menu } from "@/components/icons/ember";
import { SheetTrigger } from "@/components/ui/sheet";
import type { ConnectionStatus } from "@/lib/room-state";
import { UserAvatar } from "./user-avatar";

const MAX_FACES = 4;

export function RoomHeader({ name, present, status }: { name: string; present: User[]; status: ConnectionStatus }) {
  return (
    <header className="flex min-h-header items-center gap-3 border-b bg-background py-2.5 pr-[max(22px,env(safe-area-inset-right))] pl-[22px] max-md:min-h-14 max-md:gap-1.5 max-md:pt-[env(safe-area-inset-top)] max-md:pr-[max(8px,env(safe-area-inset-right))] max-md:pl-[max(8px,env(safe-area-inset-left))]">
      <SheetTrigger aria-label="Open conversations" className="hidden size-11 shrink-0 items-center justify-center rounded-lg max-md:flex">
        <Menu className="size-[22px]" />
      </SheetTrigger>

      <div className="flex min-w-0 flex-1 items-center gap-2.5 max-md:gap-[7px]">
        <span aria-hidden="true" className="shrink-0 text-[23px] text-muted-foreground">
          #
        </span>
        <h1 className="truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">{name}</h1>
        {status !== "open" && (
          <span role="status" className="shrink-0 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {status === "connecting" ? "Connecting…" : "Reconnecting…"}
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5" title={present.map((u) => u.name).join(", ")}>
        <span className="sr-only">{present.length} here now</span>
        <div className="flex -space-x-1.5" aria-hidden="true">
          {present.slice(0, MAX_FACES).map((user) => (
            <UserAvatar key={user.id} user={user} className="size-7 ring-2 ring-background" />
          ))}
        </div>
        {present.length > MAX_FACES && <span className="text-xs text-muted-foreground">+{present.length - MAX_FACES}</span>}
      </div>
    </header>
  );
}
