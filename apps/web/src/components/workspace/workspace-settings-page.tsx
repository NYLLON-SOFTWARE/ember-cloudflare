import { Add } from "@/components/icons/campfire";
import { PageLink } from "@/components/page-link";
import { newRoomPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/**
 * ember-rust's workspace settings (accounts/edit.html), so far just its heading and the Rooms section
 * with New room. Go Back goes to `back`, the last room visited.
 */
export function WorkspaceSettingsPage({ back }: { back: string }) {
  useTitle("Account settings");
  return (
    <SettingsPage back={back}>
      <Panel className="flex flex-col gap-x-[1ch] gap-y-4">
        <PageHeading title="Workspace settings">Manage your workspace, invitations, and people.</PageHeading>
        <section aria-labelledby="rooms-settings-heading" className="rounded-[10px] border bg-surface px-[2ch] py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="rooms-settings-heading" className="text-base font-semibold">
              Rooms
            </h2>
            <PageLink
              href={newRoomPath("open")}
              className="inline-flex min-h-11 items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-3.5 py-2.5 font-medium"
            >
              <Add width={18} height={18} className="size-[18px]" />
              <span>New room</span>
            </PageLink>
          </div>
        </section>
      </Panel>
    </SettingsPage>
  );
}
