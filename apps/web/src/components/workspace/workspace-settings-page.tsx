import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LOGO_TOO_LARGE,
  MAX_ACCOUNT_NAME_LENGTH,
  MAX_LOGO_SIZE,
  MAX_TAGLINE_LENGTH,
  type Account,
  type AccountSettings,
  type DirectoryUser,
  type Me,
  type NavigationIconChanges,
  type PersonRole,
  type RoomId,
  type SidebarRoom,
  type WorkspaceSettings,
} from "@ember/protocol";
import { AccountLogo, STOCK_LOGO } from "@/components/account-logo";
import { FIELD_INPUT, Field, SubmitButton } from "@/components/field";
import { useFlash } from "@/components/flash";
import { Crown, Plus } from "@/components/icons/iconoir";
import { scrollMainContentToTop } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAccount } from "@/hooks/use-account";
import { PeopleContext } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { newRoomPath, useHash } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { changeAccount, changeLogo, changeRole, fetchWorkspaceSettings, isSignedOut, regenerateJoinCode, removeLogo, removePerson } from "@/lib/api";
import { logoVariantsOf } from "@/lib/previews";
import { apart } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { CustomDomainSettings } from "./custom-domain-settings";
import { InviteLink } from "./invite-link";
import { MemberfulSettings } from "./memberful-settings";
import { NavigationIconSettings } from "./navigation-icon-settings";
import { PeopleList } from "./people-list";
import { PicturePicker } from "./picture-picker";
import { RoomOrder } from "./room-order";
import { workspaceSectionOf } from "./settings-navigation";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** What ember-rust's redirect back to settings says once the name is saved, changed or not (accounts.rs). */
export const CHANGES_SAVED = "Changes saved.";

/** A section's `.mb-page-heading`, 4px above what follows it in the section, which spaces its parts 24px apart. */
const SECTION_HEADING = "mb-1";

interface Props {
  me: Me;
  /** Where Go Back goes: the last room visited, as ember-rust's `link_back_to_last_room_visited` has it. */
  back: string;
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
 * ember-rust's workspace settings, as its pull request #24 splits them into three sections
 * (accounts/edit.html, d49621e), of which the address's fragment shows one, all three staying drawn so
 * what's typed in one waits there while another shows:
 *
 * - Community (accounts/_community_settings.html), where administrators change the workspace's icon, which
 *   one picked saves at once, showing it meanwhile, and Remove icon takes away, then rename the workspace,
 *   give it a tagline, this port's own, show or hide the translation buttons, and choose the rail's
 *   icons, which Save changes saves together, and give it a custom domain, this port's own too. Members
 *   see its icon, name and tagline.
 * - Rooms and permissions (accounts/_room_settings.html): New room, which members don't get while only
 *   administrators can create rooms, then for administrators, the switch that says so and the rooms'
 *   order for everyone, each linking to its settings.
 * - Membership (accounts/_membership_settings.html): for administrators, Memberful sign-in, this port's own,
 *   then the join link, which administrators can regenerate, or while members sign in with Memberful, a
 *   note that it's off, then the administrators and members, whom administrators can make administrators
 *   or members and remove.
 */
export function WorkspaceSettingsPage({
  me,
  back,
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
  // What's typed in Workspace name and Tagline, or null for either while it's as the workspace has it,
  // when the field follows the workspace socket, so that saving one never puts back what another tab
  // changed in the other.
  const [typedName, setTypedName] = useState<string | null>(null);
  const [typedTagline, setTypedTagline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** The address of the logo picked, shown while it saves. */
  const [pickedLogo, setPickedLogo] = useState<string | null>(null);
  const [savingLogo, setSavingLogo] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  // Where the Hide translation buttons switch was moved to, until Save changes saves it with the name.
  const [hidingTranslations, setHidingTranslations] = useState<boolean | null>(null);
  // The navigation icons chosen until Save changes saves them. Only these are sent, where ember-rust's
  // form sends all eight, so that saving never puts back what another tab changed in the others.
  const [iconChanges, setIconChanges] = useState<NavigationIconChanges>({});
  // Where Must be admin to create new rooms and Members sign in with Memberful were moved to, while that's saved.
  const [restrictingCreation, setRestrictingCreation] = useState<boolean | null>(null);
  const [switchingMemberful, setSwitchingMemberful] = useState<boolean | null>(null);
  const account = useAccount();
  const name = typedName ?? account.name;
  const tagline = typedTagline ?? account.tagline;
  const people = useContext(PeopleContext);
  // The people as they are now, for answers that come later.
  const peopleNow = useRef(people);
  useLayoutEffect(() => {
    peopleNow.current = people;
  }, [people]);
  const flash = useFlash();
  const mounted = useMounted();
  const section = workspaceSectionOf(useHash());
  useTitle("Community settings");

  // Another section starts at its top, as community_settings.js scrolls the page when the fragment changes.
  useLayoutEffect(scrollMainContentToTop, [section]);

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
        setTypedName(null);
        setTypedTagline(null);
        setIconChanges({});
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

  // The name, the tagline and, if they were changed, the translation buttons' switch and the navigation
  // icons, as ember-rust's form sends them together.
  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const answered = askForAccount();
    const sent = { name, tagline };
    const hideTranslationButtons = hidingTranslations;
    const navigationIcons = iconChanges;
    changeAccount({
      ...sent,
      ...(hideTranslationButtons !== null && { settings: { hideTranslationButtons } }),
      ...(Object.keys(navigationIcons).length > 0 && { navigationIcons }),
    }).then(
      (account) => {
        answered(account);
        if (!mounted.current) return;
        setSaving(false);
        // Unless it's been moved again since.
        setHidingTranslations((hiding) => (hiding === hideTranslationButtons ? null : hiding));
        // Each icon saved shows as the workspace has it now, unless another's been chosen since.
        setIconChanges((changes) => Object.fromEntries(Object.entries(changes).filter(([slot, icon]) => icon !== navigationIcons[slot as keyof NavigationIconChanges])));
        setSettings((settings) => settings && { ...settings, account });
        // Each shows as it's kept, the tagline with no space at its ends, unless it's been typed over since.
        setTypedName((typed) => (typed === sent.name ? null : typed));
        setTypedTagline((typed) => (typed === sent.tagline ? null : typed));
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
  const switchRoomCreation = (restrict: boolean) => {
    if (restrictingCreation !== null) return;
    setRestrictingCreation(restrict);
    saveSwitch({ restrictRoomCreation: restrict }, () => setRestrictingCreation(null));
  };
  const switchMemberful = (on: boolean) => {
    if (switchingMemberful !== null) return;
    setSwitchingMemberful(on);
    saveSwitch({ memberfulSignIn: on }, () => setSwitchingMemberful(null));
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

  return (
    <SettingsPage back={back}>
      <Panel
        id="community-settings"
        hidden={section !== "community-settings"}
        aria-labelledby="community-settings-heading"
        aria-busy={settings === null}
        className="flex flex-col gap-6"
      >
        <PageHeading id="community-settings-heading" title="Basic community settings" className={SECTION_HEADING}>
          Manage your community name, icon, and preferences.
        </PageHeading>
        {settings &&
          (settings.canAdminister ? (
            <>
              <PicturePicker
                id="account_logo"
                src={pickedLogo ?? account.logo ?? STOCK_LOGO}
                alt="Community icon"
                label="Upload icon"
                description="Choose a community icon"
                onChoose={saveLogo}
                disabled={savingLogo}
                // As ember-rust's Remove icon does: no confirmation first, and no notice after.
                remove={account.logo ? { label: "Remove icon", onRemove: () => showLogo(removeLogo()) } : null}
              />
              {/* `.mb-community-form`. */}
              <form onSubmit={save} className="flex flex-col gap-6">
                <Field id="account_name" label="Community name" translation="account_name">
                  {/* Not focused as the page opens, and the cursor goes where it's put, as in ember-rust. */}
                  <Input
                    id="account_name"
                    autoComplete="off"
                    maxLength={MAX_ACCOUNT_NAME_LENGTH}
                    placeholder="Name this account"
                    data-ember-preserve-selection
                    value={name}
                    onChange={(event) => setTypedName(event.target.value)}
                    // zz-ember.css takes the focus ring off this field alone.
                    className={cn(FIELD_INPUT, "focus-visible:outline-none")}
                  />
                </Field>
                <Field id="account_tagline" label="Tagline">
                  <Input
                    id="account_tagline"
                    autoComplete="off"
                    maxLength={MAX_TAGLINE_LENGTH}
                    placeholder="Sum it up in a few words"
                    aria-describedby="account-tagline-description"
                    value={tagline}
                    onChange={(event) => setTypedTagline(event.target.value)}
                    className={FIELD_INPUT}
                  />
                  <p id="account-tagline-description" className="text-[0.8em] text-muted-foreground">
                    Shown under the community name in the sidebar, up to {MAX_TAGLINE_LENGTH} characters. Leave it empty for none.
                  </p>
                </Field>
                <div id="localization-settings" className="mt-1 flex items-center gap-x-[1ch] gap-y-4 rounded-[10px] border bg-surface p-5">
                  <div className="min-w-0 flex-1 text-start">
                    <div>Hide translation buttons</div>
                    <p id="localization-description" className="text-[0.8em] text-muted-foreground max-md:text-[12px]">
                      Hide language help throughout the app for everyone.
                    </p>
                  </div>
                  <Switch
                    checked={hidingTranslations ?? account.hideTranslationButtons}
                    onCheckedChange={setHidingTranslations}
                    aria-label="Hide translation buttons"
                    aria-describedby="localization-description"
                  />
                </div>
                <NavigationIconSettings
                  changes={iconChanges}
                  onChange={(slot, icon) => setIconChanges((changes) => ({ ...changes, [slot]: icon }))}
                  disabled={saving}
                />
                {/* On a page of community settings, as wide as it needs, but at least 126px, at the form's end. */}
                <SubmitButton disabled={saving} className="w-auto min-w-[126px] self-end">
                  Save changes
                </SubmitButton>
              </form>
              <CustomDomainSettings askForAccount={askForAccount} onSaved={() => flash("notice", CHANGES_SAVED)} onFailed={onFailed} />
            </>
          ) : (
            <>
              {/* `account_logo_tag(style: "txt-xx-large center")`: 5ch wide at 2.4rem. */}
              <AccountLogo src={account.logo ?? STOCK_LOGO} className="mx-auto w-[5ch] text-[2.4rem]" />
              <hgroup>
                <h2 className="text-[24px] font-bold wrap-anywhere max-md:text-[22px]">{account.name}</h2>
                {account.tagline && <p className="text-muted-foreground wrap-anywhere">{account.tagline}</p>}
              </hgroup>
            </>
          ))}
      </Panel>
      <Panel id="channel-settings" hidden={section !== "channel-settings"} aria-labelledby="channel-settings-heading" className="flex flex-col gap-6">
        {/* `.mb-channel-settings-heading`. */}
        <div className="flex flex-wrap items-center justify-between gap-3 upto-500px:items-start">
          <h2 id="channel-settings-heading" className="text-[24px] font-semibold upto-500px:text-[22px]">
            Room order and permissions
          </h2>
          {(me.administrator || !account.restrictRoomCreation) && (
            <PageLink
              href={newRoomPath("open")}
              className="inline-flex min-h-11 items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-3.5 py-2.5 font-medium"
            >
              <Plus className="size-[18px]" />
              <span>New room</span>
            </PageLink>
          )}
        </div>
        {settings?.canAdminister ? (
          <>
            {/* `.mb-channel-settings-permissions`. */}
            <div className="flex items-center gap-x-[1ch] gap-y-4 border-t pt-5">
              <div className="flex min-w-0 grow items-center gap-x-[1ch] text-start">
                <Crown className="size-[18px]" />
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
        ) : (
          settings && <p className="text-muted-foreground">Community admins manage room order and permissions.</p>
        )}
      </Panel>
      <Panel id="membership-settings" hidden={section !== "membership-settings"} aria-labelledby="membership-settings-heading" className="flex flex-col gap-6">
        <PageHeading id="membership-settings-heading" title="Membership" className={SECTION_HEADING}>
          Invite people and manage access to your community.
        </PageHeading>
        {settings && (
          // `.mb-membership-content`.
          <div className="min-w-0">
            {settings.canAdminister && (
              <div className="mb-4">
                <MemberfulSettings
                  site={settings.memberfulSite}
                  webhooks={settings.memberfulWebhooks}
                  checked={switchingMemberful ?? account.memberfulSignIn}
                  onCheckedChange={switchMemberful}
                />
              </div>
            )}
            {account.memberfulSignIn ? (
              <p className="text-start">
                <strong>Members sign in with Memberful</strong>, so the join link is off.
              </p>
            ) : (
              // `#account_invitation`, a card on the surface.
              <div className="rounded-[10px] border bg-surface p-5 upto-500px:p-3.5">
                <InviteLink joinCode={settings.joinCode} onRegenerate={settings.canAdminister ? regenerate : undefined} regenerating={regenerating} />
              </div>
            )}
            <hr className="my-4 w-full" />
            <PeopleList
              people={people}
              myId={me.id}
              onChangeRole={settings.canAdminister ? changeRoleOf : undefined}
              onRemove={settings.canAdminister ? removeOf : undefined}
            />
          </div>
        )}
      </Panel>
    </SettingsPage>
  );
}
