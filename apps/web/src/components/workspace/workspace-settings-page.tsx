import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LOGO_TOO_LARGE,
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_LOGO_SIZE,
  type Account,
  type AccountSettings,
  type DirectoryUser,
  type Me,
  type PersonRole,
  type RoomId,
  type SidebarRoom,
  type WorkspaceSettings,
} from "@ember/protocol";
import { AccountLogo, STOCK_LOGO } from "@/components/account-logo";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Add, Art, Bot, Crown } from "@/components/icons/campfire";
import { PageLink } from "@/components/page-link";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Version } from "@/components/version";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { BOTS_PATH, CUSTOM_STYLES_PATH, newRoomPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeAccount, changeLogo, changeRole, fetchWorkspaceSettings, isSignedOut, regenerateJoinCode, removeLogo, removePerson } from "@/lib/api";
import { logoVariantsOf } from "@/lib/previews";
import { apart } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { InviteLink } from "./invite-link";
import { HEADER_TEXT_BUTTON } from "./page-header";
import { PeopleList } from "./people-list";
import { PicturePicker } from "./picture-picker";
import { RoomOrder } from "./room-order";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** What ember-rust's redirect back to settings says once the name is saved, changed or not (accounts.rs). */
export const CHANGES_SAVED = "Changes saved.";

interface Props {
  me: Me;
  /** Where Go Back goes: the last room visited, as ember-rust's `link_back_to_last_room_visited` has it. */
  back: string;
  /** This deployment's version, which the page ends with. */
  version: string;
  /**
   * Called as the page asks for the workspace, by loading or saving it. What it returns is called with
   * the workspace the server answers, for the rail and sidebar to show.
   */
  askForAccount: () => (account: Account) => void;
  /** Called with the join link's code as the page loads or regenerates it, for the welcome card to show. */
  onJoinCodeChanged: (joinCode: string) => void;
  /** Loads the people directory again, which the page lists people from, settling once it has or failed. */
  reloadPeople: () => Promise<void>;
  /** Called with someone as the page changes them, for the people directory to show. */
  onPersonChanged: (person: DirectoryUser) => void;
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  /** The rooms in this person's sidebar, as it lists them now, or null until it has. */
  rooms: SidebarRoom[] | null;
  /** The ones of them the shared order ranks, in its order. */
  sharedOrder: RoomId[];
  /** Called with the rooms of theirs the shared order ranks, as the server answers them, once they save it. */
  onSharedOrderSaved: (sharedOrder: RoomId[]) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * ember-rust's workspace settings (accounts/edit.html), as far as they're built: administrators change
 * the workspace's logo, which a logo picked saves at once, showing it meanwhile, and Remove logo takes
 * away, rename the workspace, show or hide the translation buttons, and have a link to the Custom CSS
 * page, and members see its logo and name. Then comes the Rooms section with New room, which members
 * don't get while only administrators can create rooms, and where administrators switch that on or off
 * and put the rooms in order for everyone. Then the join link, which administrators can regenerate, the
 * people, whom administrators can make administrators or members and remove, and "Ember™ version" at
 * the foot.
 */
export function WorkspaceSettingsPage({
  me,
  back,
  version,
  askForAccount,
  onJoinCodeChanged,
  reloadPeople,
  onPersonChanged,
  onFailed,
  rooms,
  sharedOrder,
  onSharedOrderSaved,
  onSessionChanged,
}: Props) {
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  /** The address of the logo picked, shown while it saves. */
  const [pickedLogo, setPickedLogo] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Where the Hide translation buttons switch was moved to, while that's saved, and Must be admin to create new rooms.
  const [hidingTranslations, setHidingTranslations] = useState<boolean | null>(null);
  const [restrictingCreation, setRestrictingCreation] = useState<boolean | null>(null);
  const account = useAccount();
  const people = useContext(PeopleContext);
  // The people as they are now, for answers that come later.
  const peopleNow = useRef(people);
  useLayoutEffect(() => {
    peopleNow.current = people;
  }, [people]);
  const flash = useFlash();
  const mounted = useMounted();
  useTitle("Account settings");

  // A page that has gone only reports a session that's ended, which goes to sign in.
  const listPeople = useCallback(
    () => void reloadPeople().catch((error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error)),
    [reloadPeople, onFailed, mounted],
  );

  // As ember-rust lists everyone as the page loads, rather than as the directory last loaded.
  useEffect(() => listPeople(), [listPeople]);

  // Loaded again when someone makes them an administrator or a member, which changes what they can do here.
  const administrator = me.administrator;
  useEffect(() => {
    let stopped = false;
    const answered = askForAccount();
    fetchWorkspaceSettings().then(
      (settings) => {
        if (stopped) return;
        setSettings(settings);
        setName(settings.account.name);
        answered(settings.account);
        onJoinCodeChanged(settings.joinCode);
      },
      (error: unknown) => {
        // A page left before its settings load only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [administrator, askForAccount, onJoinCodeChanged, onFailed]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const answered = askForAccount();
    changeAccount({ name }).then(
      (account) => {
        answered(account);
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

  // The picked logo's address is let go of once the saved one takes its place.
  useEffect(() => () => void (pickedLogo && URL.revokeObjectURL(pickedLogo)), [pickedLogo]);

  /** Saves `file` as the workspace's logo, as ember-rust's picker sends the account's form once a logo is picked. */
  const saveLogo = (file: File) => {
    if (file.size > MAX_LOGO_SIZE) return flash("alert", LOGO_TOO_LARGE);
    setPickedLogo(URL.createObjectURL(file));
    showLogo(logoVariantsOf(file).then((variants) => changeLogo({ file, variants })), CHANGES_SAVED);
  };

  /** Shows the workspace's logo as `change` saves it, flashing `notice` once it has. */
  function showLogo(change: Promise<Account>, notice?: string) {
    setSavingLogo(true);
    const answered = askForAccount();
    change.then(
      (account) => {
        answered(account);
        if (!mounted.current) return;
        setSavingLogo(false);
        setPickedLogo(null);
        setSettings((settings) => settings && { ...settings, account });
        if (notice) flash("notice", notice);
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setSavingLogo(false);
        setPickedLogo(null);
        onFailed(error);
      },
    );
  }

  // As ember-rust's switches do: saved at once, with no notice after, then `settled` is called.
  const saveSwitch = (settings: AccountSettings, settled: () => void) => {
    const answered = askForAccount();
    changeAccount({ settings }).then(
      (account) => {
        answered(account);
        if (mounted.current) settled();
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        settled();
        onFailed(error);
      },
    );
  };
  const switchTranslations = (hide: boolean) => {
    if (hidingTranslations !== null) return;
    setHidingTranslations(hide);
    saveSwitch({ hideTranslationButtons: hide }, () => setHidingTranslations(null));
  };
  const switchRoomCreation = (restrict: boolean) => {
    if (restrictingCreation !== null) return;
    setRestrictingCreation(restrict);
    saveSwitch({ restrictRoomCreation: restrict }, () => setRestrictingCreation(null));
  };
  const sharedRooms = useMemo(() => rooms && apart(rooms).shared, [rooms]);

  // As ember-rust's Regenerate join link does: no confirmation first, and no notice after.
  const regenerate = () => {
    setRegenerating(true);
    regenerateJoinCode().then(
      (joinCode) => {
        onJoinCodeChanged(joinCode);
        if (!mounted.current) return;
        setRegenerating(false);
        setSettings((settings) => settings && { ...settings, joinCode });
      },
      (error: unknown) => {
        if (!mounted.current && !isSignedOut(error)) return;
        setRegenerating(false);
        onFailed(error);
      },
    );
  };

  // As ember-rust's crowns do: no notice after. Once the workspace socket or a load has said the person
  // changed while the answer was on its way, the answer may be older than that, so it's left out, and the
  // directory loads again unless they already have the role it gives them.
  const changeRoleOf = useCallback(
    (person: DirectoryUser, role: PersonRole) =>
      changeRole(person.id, role).then(
        (changed) => {
          const listed = peopleNow.current.get(person.id);
          if (listed === person) onPersonChanged(changed);
          else if (listed?.role !== changed.role) listPeople();
        },
        (error: unknown) => {
          if (mounted.current || isSignedOut(error)) onFailed(error);
        },
      ),
    [onPersonChanged, onFailed, mounted, listPeople],
  );

  // As ember-rust's Delete does: no notice after, once it's confirmed. The person leaves the list as the
  // directory hears they're removed, from this answer or the workspace socket, as a role's answer is kept.
  const removeOf = useCallback(
    (person: DirectoryUser) =>
      removePerson(person.id).then(
        (removed) => {
          const listed = peopleNow.current.get(person.id);
          if (listed === person) onPersonChanged(removed);
          else if (listed?.status !== removed.status) listPeople();
        },
        (error: unknown) => {
          if (mounted.current || isSignedOut(error)) onFailed(error);
        },
      ),
    [onPersonChanged, onFailed, mounted, listPeople],
  );

  // zz-ember.css leaves only their icons on screen at 500px wide and below.
  const links = settings?.canAdminister && (
    <>
      <PageLink href={BOTS_PATH} className={cn(HEADER_TEXT_BUTTON, "max-[500px]:size-11 max-[500px]:p-0")}>
        <Bot width={20} height={20} className="h-5 w-[1.3em]" />
        <span className="max-[500px]:sr-only">Chat bots</span>
      </PageLink>
      <PageLink href={CUSTOM_STYLES_PATH} className={cn(HEADER_TEXT_BUTTON, "max-[500px]:size-11 max-[500px]:p-0")}>
        <Art width={20} height={20} className="h-5 w-[1.3em]" />
        <span className="max-[500px]:sr-only">Custom styles</span>
      </PageLink>
    </>
  );

  return (
    <SettingsPage back={back} links={links}>
      <Panel aria-busy={settings === null} className="flex flex-col gap-x-[1ch] gap-y-4">
        <PageHeading title="Workspace settings">Manage your workspace, invitations, and people.</PageHeading>
        {settings &&
          (settings.canAdminister ? (
            <>
              <PicturePicker
                id="account_logo"
                src={pickedLogo ?? account.logo ?? STOCK_LOGO}
                alt="Workspace logo"
                label="Upload logo"
                description="Choose a workspace logo"
                onChoose={saveLogo}
                disabled={savingLogo}
                // As ember-rust's Remove logo does: no confirmation first, and no notice after.
                remove={account.logo ? { label: "Remove logo", onRemove: () => showLogo(removeLogo()) } : null}
              />
              <form onSubmit={save} className="flex flex-col gap-4">
                <Field id="account_name" label="Workspace name" translation="account_name">
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
              <div id="localization-settings" className="flex items-center gap-x-[1ch] gap-y-4 rounded-[10px] border bg-surface px-[2ch] py-4 max-md:px-3">
                <div className="min-w-0 flex-1 text-start">
                  <div>Hide translation buttons</div>
                  <p id="localization-description" className="text-[0.8em] text-muted-foreground max-md:text-[12px]">
                    Hide language help throughout the app for everyone.
                  </p>
                </div>
                <Switch
                  checked={hidingTranslations ?? account.hideTranslationButtons}
                  onCheckedChange={switchTranslations}
                  aria-label="Hide translation buttons"
                  aria-describedby="localization-description"
                />
              </div>
            </>
          ) : (
            <>
              {/* `account_logo_tag(style: "txt-xx-large center")`: 5ch wide at 2.4rem. */}
              <AccountLogo src={account.logo ?? STOCK_LOGO} className="mx-auto w-[5ch] text-[2.4rem]" />
              <h2 className="text-[24px] font-bold wrap-anywhere max-md:text-[22px]">{account.name}</h2>
            </>
          ))}
        {(me.administrator || !account.restrictRoomCreation) && (
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
            {settings?.canAdminister && (
              <>
                {/* `.mb-channel-settings-permissions`. */}
                <div className="mt-4 flex items-center gap-x-[1ch] gap-y-4 border-t pt-4">
                  <div className="flex min-w-0 grow items-center gap-x-[1ch] text-start">
                    <Crown width={18} height={18} className="size-[18px]" />
                    Must be admin to create new rooms
                  </div>
                  <Switch
                    checked={restrictingCreation ?? account.restrictRoomCreation}
                    onCheckedChange={switchRoomCreation}
                    aria-label="Must be admin to create new rooms"
                  />
                </div>
                {sharedRooms && <RoomOrder rooms={sharedRooms} sharedOrder={sharedOrder} onSaved={onSharedOrderSaved} onSessionChanged={onSessionChanged} />}
              </>
            )}
          </section>
        )}
        {/* ember-rust's box holds the people too, under the link (accounts/edit.html). */}
        {settings && (
          <div className="my-4 rounded-[10px] border bg-surface px-[1ch] pt-4">
            <InviteLink joinCode={settings.joinCode} onRegenerate={settings.canAdminister ? regenerate : undefined} regenerating={regenerating} />
            <hr className="my-4 w-full" />
            <h2 id="people-heading" className="mb-3 text-base font-semibold">
              People
            </h2>
            <PeopleList
              people={people}
              myId={me.id}
              onChangeRole={settings.canAdminister ? changeRoleOf : undefined}
              onRemove={settings.canAdminister ? removeOf : undefined}
              aria-labelledby="people-heading"
            />
          </div>
        )}
      </Panel>
      <footer>
        <Version version={version} className="my-8 text-center" />
      </footer>
    </SettingsPage>
  );
}
