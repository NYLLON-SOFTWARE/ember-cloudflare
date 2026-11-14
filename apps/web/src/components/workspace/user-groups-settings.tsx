import { useContext, useEffect, useState, type FormEvent } from "react";
import { MAX_GROUP_MEMBERS, MAX_GROUP_NAME_LENGTH, type GroupId, type UserGroup, type UserId } from "@ember/protocol";
import { FIELD_INPUT, Field } from "@/components/field";
import { EditPencil, Minus, Plus } from "@/components/icons/iconoir";
import { DirectoryLoaded, PeopleContext } from "@/hooks/use-directory";
import { ApiError, changeUserGroup, createUserGroup, deleteUserGroup, fetchUserGroups, isSignedOut } from "@/lib/api";
import { byName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { BUTTON } from "./email-settings";
import { ROUND_BUTTON } from "./link-buttons";

// The User groups card on workspace settings, for administrators: New group, then each group, by name,
// with how many people a mention of it stands for, and buttons to change its name and members, and to
// delete it. A mention of the group notifies everyone in it, so its members are the workspace's active
// people, which the form's checkboxes list. Each change loads the people directory again, which a
// message's showing and naming read, so it says whom a group stands for as it now does.

/** What the card says of groups. */
export const GROUPS_EXPLAINED = `People mention a group by name, and everyone in it is notified. A group can have up to ${MAX_GROUP_MEMBERS} members.`;

/** What Delete asks before it deletes a group. */
export const CONFIRM_DELETE = "Delete this group? Messages mentioning it will no longer name anyone.";

/** What the form says when the server refuses the name or the members. */
const sayWhy = (error: unknown) => (error instanceof ApiError ? error.message : "That couldn't be saved. Try again.");

interface Props {
  /** Called once a change has saved, for the page to flash its notice. */
  onSaved: () => void;
  /** Loads the people directory again, whose groups a mention's showing and naming read, as a change here has them now. */
  reloadDirectory: () => void;
  /** Says why loading or saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** The User groups card: New group, then the groups, by name, each with how many it stands for and its buttons. */
export function UserGroups({ onSaved, reloadDirectory, onFailed }: Props) {
  const [groups, setGroups] = useState<UserGroup[] | null>(null);
  // The group whose form is open, or "new" for one it's making, or null while the card lists only.
  const [editing, setEditing] = useState<GroupId | "new" | null>(null);

  useEffect(() => {
    let stopped = false;
    fetchUserGroups().then(
      (groups) => !stopped && setGroups(groups),
      (error: unknown) => {
        // A card gone before its groups load only reports a session that's ended, which goes to sign in.
        if (!stopped || isSignedOut(error)) onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [onFailed]);

  /** Shows `group` as the server answers it, closes the form, and says the change saved. */
  const saved = (group: UserGroup) => {
    setGroups((groups) => (groups?.some((listed) => listed.id === group.id) ? groups.map((listed) => (listed.id === group.id ? group : listed)) : [...(groups ?? []), group]));
    setEditing(null);
    reloadDirectory();
    onSaved();
  };

  /** Deletes `group` for good, which the list drops. */
  const remove = (group: UserGroup) => {
    if (!confirm(CONFIRM_DELETE)) return;
    deleteUserGroup(group.id).then(
      () => {
        setGroups((groups) => groups?.filter((listed) => listed.id !== group.id) ?? []);
        reloadDirectory();
      },
      // A delete that couldn't be sent says so, as a save's does, and the group stays to be tried again.
      onFailed,
    );
  };

  const editingGroup = editing === null || editing === "new" ? null : (groups?.find((group) => group.id === editing) ?? null);
  return (
    <section aria-labelledby="user-groups-heading" aria-busy={groups === null} className="flex flex-col gap-3 rounded-[10px] border bg-surface px-[2ch] py-4 text-start max-md:px-3">
      <div className="flex flex-wrap items-center gap-x-[1ch] gap-y-3">
        <div className="min-w-[16em] flex-1">
          <h2 id="user-groups-heading" className="text-base font-semibold">
            User groups
          </h2>
          <p className="text-[0.8em] text-muted-foreground max-md:text-[12px]">{GROUPS_EXPLAINED}</p>
        </div>
        {editing === "new" ? null : (
          <button type="button" onClick={() => setEditing("new")} className={cn(BUTTON, "gap-[0.5em]")}>
            <Plus className="size-[18px]" />
            <span>New group</span>
          </button>
        )}
      </div>
      {editing === "new" && <GroupForm group={null} onSaved={saved} onCancel={() => setEditing(null)} onFailed={onFailed} />}
      <ul aria-labelledby="user-groups-heading" className="flex flex-col">
        {groups?.map((group) => (
          <li key={group.id} className="flex items-center gap-x-[1.5ch] border-t py-3 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-x-[1ch]">
                <strong className="truncate">{group.name}</strong>
              </div>
              <p className="text-[0.9em] text-muted-foreground max-md:text-[13px]">
                {group.memberIds.length} {group.memberIds.length === 1 ? "member" : "members"}
              </p>
            </div>
            <button type="button" onClick={() => setEditing(group.id)} className={cn(ROUND_BUTTON, "border bg-background")}>
              <EditPencil className="size-[1.3em]" />
              <span className="sr-only">Edit {group.name}</span>
            </button>
            <DeleteGroupButton group={group} onConfirm={() => remove(group)} />
          </li>
        ))}
      </ul>
      {/* Keyed by the group's id, so Edit on another group opens with its name and members, not the last form's. */}
      {editingGroup && <GroupForm key={editingGroup.id} group={editingGroup} onSaved={saved} onCancel={() => setEditing(null)} onFailed={onFailed} />}
    </section>
  );
}

/** Delete, a round red button that asks before it deletes, as the people list's does. */
function DeleteGroupButton({ group, onConfirm }: { group: UserGroup; onConfirm: () => void }) {
  return (
    <button
      type="button"
      onClick={onConfirm}
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-negative-button text-[0.8rem] text-white touch:size-11 hover:not-active:brightness-70"
    >
      <Minus className="size-[1.3em]" />
      <span className="sr-only">Delete {group.name}</span>
    </button>
  );
}

interface GroupFormProps {
  /** The group the form changes, or null for one it makes. */
  group: UserGroup | null;
  /** Shows the group as the server answers it, once it has. */
  onSaved: (group: UserGroup) => void;
  /** Closes the form, keeping the group as it was. */
  onCancel: () => void;
  /** Says why saving failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The form for a group's name and members: a field for the name, then a checkbox for each active person,
 * and Create group or Save changes beside Cancel under them. Saving sends the name and the members
 * together, and shows what the server refused them with, as a name another group has, however it's
 * capitalised. A member the directory lists gone, as a deactivated one's id is, is let go of, for no
 * checkbox offers them to be unchecked.
 */
function GroupForm({ group, onSaved, onCancel, onFailed }: GroupFormProps) {
  const directory = useContext(PeopleContext);
  const loaded = useContext(DirectoryLoaded);
  const people = byName([...directory.values()].filter((person) => person.status === "active" && person.role !== "bot"));
  const [name, setName] = useState(group?.name ?? "");
  const [members, setMembers] = useState<ReadonlySet<UserId>>(() => new Set(group?.memberIds ?? []));
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  // A group keeps the id of a member the directory lists gone, whom the checkboxes offer no line to
  // uncheck: once the directory has loaded, let them go, so a save keeps only who's checked, and can't
  // be refused for the one it would otherwise send back unseen.
  useEffect(() => {
    if (!loaded) return;
    setMembers((members) => {
      const next = [...members].filter((id) => directory.get(id)?.status === "active");
      return next.length === members.size ? members : new Set(next);
    });
  }, [loaded, directory]);

  const toggle = (userId: UserId, checked: boolean) =>
    setMembers((members) => {
      const next = new Set(members);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });

  const save = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setRefused(null);
    const memberIds = [...members];
    const change = group ? changeUserGroup(group.id, { name, memberIds }) : createUserGroup({ name, memberIds });
    change.then(
      onSaved,
      (error: unknown) => {
        if (isSignedOut(error)) return onFailed(error);
        setSaving(false);
        setRefused(sayWhy(error));
      },
    );
  };

  return (
    <form noValidate onSubmit={save} className="flex flex-col gap-4 border-t pt-4">
      <Field id="user-group-name" label="Name">
        <Input
          id="user-group-name"
          autoComplete="off"
          maxLength={MAX_GROUP_NAME_LENGTH}
          placeholder="Design, On call…"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD_INPUT}
        />
        <p className="text-[0.8em] text-muted-foreground max-md:text-[12px]">Shown to whoever mentions it, in lowercase letters.</p>
      </Field>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 text-[0.8em] text-muted-foreground max-md:text-[12px]">Members, up to {MAX_GROUP_MEMBERS}</legend>
        {people.map((person) => (
          <label key={person.id} className="flex min-h-11 cursor-pointer items-center gap-[1ch] rounded-[8px] px-2 hover:bg-hover">
            <input
              type="checkbox"
              checked={members.has(person.id)}
              onChange={(event) => toggle(person.id, event.target.checked)}
              className="m-0 size-4 flex-none cursor-pointer accent-foreground"
            />
            <span className="truncate text-sm">{person.name}</span>
          </label>
        ))}
      </fieldset>
      {refused && (
        <p role="alert" className="text-[13px] leading-normal text-negative">
          {refused}
        </p>
      )}
      <div className="flex items-center justify-end gap-[1ch]">
        <button type="button" onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
        <button type="submit" disabled={saving || name.trim() === ""} className={cn(BUTTON, "bg-foreground text-background")}>
          {group ? "Save changes" : "Create group"}
        </button>
      </div>
    </form>
  );
}
