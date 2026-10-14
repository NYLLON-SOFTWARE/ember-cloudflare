import { useEffect, useState, type FormEvent } from "react";
import { MAX_ACCOUNT_NAME_LENGTH, type Account, type WorkspaceSettings } from "@ember/protocol";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Add } from "@/components/icons/campfire";
import { PageLink } from "@/components/page-link";
import { Input } from "@/components/ui/input";
import { Version } from "@/components/version";
import { useMounted } from "@/hooks/use-mounted";
import { newRoomPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeAccount, fetchWorkspaceSettings, isSignedOut } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** What ember-rust's redirect back to settings says once the name is saved, changed or not (accounts.rs). */
export const CHANGES_SAVED = "Changes saved.";

interface Props {
  /** Where Go Back goes: the last room visited, as ember-rust's `link_back_to_last_room_visited` has it. */
  back: string;
  /** This deployment's version, which the page ends with. */
  version: string;
  /** Called with the workspace as the page loads or saves it, for the rail and sidebar to show. */
  onAccountChanged: (account: Account) => void;
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's workspace settings (accounts/edit.html), as far as they're built: administrators rename
 * the workspace and members see its name, then everyone gets the Rooms section with New room, and
 * "Ember™ version" at the foot.
 */
export function WorkspaceSettingsPage({ back, version, onAccountChanged, onFailed }: Props) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const flash = useFlash();
  const mounted = useMounted();
  useTitle("Account settings");

  useEffect(() => {
    let stopped = false;
    fetchWorkspaceSettings().then(
      (settings) => {
        if (stopped) return;
        setSettings(settings);
        setName(settings.account.name);
        onAccountChanged(settings.account);
      },
      (error: unknown) => {
        // A page left before its settings load only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [onAccountChanged, onFailed]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    changeAccount({ name }).then(
      (account) => {
        onAccountChanged(account);
        if (!mounted.current) return;
        setSaving(false);
        setSettings((settings) => settings && { ...settings, account });
        flash("notice", CHANGES_SAVED);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  return (
    <SettingsPage back={back}>
      <Panel aria-busy={settings === null} className="flex flex-col gap-x-[1ch] gap-y-4">
        <PageHeading title="Workspace settings">Manage your workspace, invitations, and people.</PageHeading>
        {settings &&
          (settings.canAdminister ? (
            <form onSubmit={save} className="flex flex-col gap-4">
              <Field id="account_name" label="Workspace name">
                {/* Not focused as the page opens, and the cursor goes where it's put, as in ember-rust. */}
                <Input
                  id="account_name"
                  autoComplete="off"
                  maxLength={MAX_ACCOUNT_NAME_LENGTH}
                  placeholder="Name this account"
                  data-ember-preserve-selection
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  // zz-ember.css takes the focus ring off this field alone.
                  className={cn(FIELD_INPUT, "focus-visible:outline-none")}
                />
              </Field>
              <SubmitButton disabled={saving}>Save changes</SubmitButton>
            </form>
          ) : (
            <h2 className="text-[24px] font-bold wrap-anywhere max-md:text-[22px]">{settings.account.name}</h2>
          ))}
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
      <footer>
        <Version version={version} className="my-8 text-center" />
      </footer>
    </SettingsPage>
  );
}
