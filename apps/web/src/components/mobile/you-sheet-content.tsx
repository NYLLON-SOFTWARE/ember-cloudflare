import type { ReactNode } from "react";
import type { Me } from "@ember/protocol";
import { User } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PROFILE_PATH, WORKSPACE_SETTINGS_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { AppearanceChoices } from "../workspace/appearance-choices";
import { NavigationIcon } from "../workspace/navigation-icon";
import { UserAvatar } from "../workspace/user-avatar";

/** One of the sheet's rows, a fingertip's 48px tall at least, as an action sheet's are. */
const ROW = "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-start text-base text-foreground no-underline hover:bg-hover active:bg-hover";

interface Props {
  me: Me;
  newRelease: string | null;
  onClose: () => void;
}

/** The You sheet's content (`YouButton`), which loads with the pages. */
export function YouSheet({ me, newRelease, onClose }: Props) {
  const workspace = me.administrator ? "Admin" : "Workspace";
  return (
    <SheetContent
      side="bottom"
      showCloseButton={false}
      className={cn(
        "mx-auto max-h-[calc(100dvh-env(safe-area-inset-top)-48px)] max-w-[560px] gap-1 overflow-y-auto overscroll-contain rounded-t-[20px] border-x px-2 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] outline-none",
        "pr-[max(8px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))]",
      )}
    >
      {/* The grabber, drawn as iOS draws a sheet's. */}
      <span aria-hidden="true" className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/40" />
      <div className="flex min-h-12 items-center gap-3 px-4 pt-1 pb-2">
        <UserAvatar user={me} className="size-10" />
        <SheetTitle className="min-w-0 truncate text-[17px] font-semibold">{me.name}</SheetTitle>
      </div>
      <SheetDescription className="sr-only">Your profile, the workspace’s settings and the appearance</SheetDescription>
      <SheetLink href={PROFILE_PATH} icon={<User className="size-6" />} onClick={onClose}>
        Your profile
      </SheetLink>
      <SheetLink
        href={WORKSPACE_SETTINGS_PATH}
        icon={<NavigationIcon slot="admin" size={24} className="size-6" />}
        detail={newRelease === null ? undefined : `Ember ${newRelease} is available`}
        onClick={onClose}
      >
        {workspace}
      </SheetLink>
      <hr className="mx-4 my-1 border-t" />
      <AppearanceChoices legendClassName="px-4 pt-1 pb-1" choiceClassName={cn(ROW, "touch:min-h-12")} iconSize={24} />
    </SheetContent>
  );
}

interface SheetLinkProps {
  href: string;
  icon: ReactNode;
  children: string;
  /** What it says under its label, smaller and muted, when there's news. */
  detail?: string;
  onClick: () => void;
}

/** A row of the sheet that goes to another page, closing the sheet as it does. */
function SheetLink({ href, icon, children, detail, onClick }: SheetLinkProps) {
  return (
    <PageLink href={href} onClick={onClick} aria-label={children} aria-description={detail} className={ROW}>
      <span className="grid size-6 shrink-0 place-items-center text-muted-foreground">{icon}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{children}</span>
        {detail && (
          <span aria-hidden="true" className="truncate text-sm text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
    </PageLink>
  );
}
