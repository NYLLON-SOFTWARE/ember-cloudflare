import { createContext, useContext, useState } from "react";
import type { Me } from "@ember/protocol";
import { Sheet, SheetTrigger } from "@/components/ui/sheet";
import { preloadRarePages, RarePage, useOpenedRarePage } from "../workspace/rare-pages";
import { UserAvatar } from "../workspace/user-avatar";

/** The release of Ember out since this one, which the You sheet's Admin says is available, or null for none. */
export const NewReleaseContext = createContext<string | null>(null);

/**
 * Your avatar, at the top right of each tab's page on a phone, dotted when a new release of Ember is out,
 * which opens the You sheet, Slack's: your
 * name, then Your profile, Admin, or Workspace for anyone else, which says when a new release of Ember is
 * out, and the appearance choices, which apply at once and leave the sheet open.
 */
export function YouButton({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const [opened, failed] = useOpenedRarePage(open, () => setOpen(false));
  const newRelease = useContext(NewReleaseContext);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label="You"
        onPointerDown={preloadRarePages}
        aria-description={newRelease === null ? undefined : `Ember ${newRelease} is available`}
        className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-full"
      >
        <UserAvatar user={me} className="size-9" />
        {newRelease !== null && <span aria-hidden="true" className="absolute top-0.5 right-0.5 size-[11px] rounded-full border-2 border-background bg-foreground" />}
      </SheetTrigger>
      {/* The sheet loads with the pages the first time it opens, and stays to slide away. */}
      {opened && <RarePage show={({ YouSheet }) => <YouSheet me={me} newRelease={newRelease} onClose={close} />} loading={null} onFailed={failed} />}
    </Sheet>
  );
}
