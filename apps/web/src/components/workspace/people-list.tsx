import { useMemo, useState } from "react";
import type { DirectoryUser, PersonRole, UserId } from "@ember/protocol";
import { Cancel, Crown, Minus, Pencil } from "@/components/icons/campfire";
import { PageLink } from "@/components/page-link";
import type { People } from "@/hooks/use-directory";
import { PROFILE_PATH } from "@/hooks/use-route";
import { byName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { ListRow, ListSeparator } from "./list-row";
import { AvatarLink } from "./user-avatar";

// ember-rust's people on workspace settings (accounts/edit.html, accounts/users/_user.html): everyone but
// bots by name, administrators first, with a rule before the members when there are both, each avatar
// linking to the person's page, and your own row to your profile. Administrators also see who's banned,
// dimmed under Campfire's cancel mark (avatars.css), and on each active person's row a crown that makes
// them an administrator or a member again, and, but on their own, Delete, which removes them.

/** What ember-rust's Delete asks before removing someone (accounts/users/_user.html). */
export const CONFIRM_REMOVE = "Are you sure you want to permanently remove this person from the account? This can’t be undone.";

interface Props {
  people: People;
  /** Whoever's looking, whose own row has My settings, and whose crown can't be pressed, so there's always an administrator. */
  myId: UserId;
  /** Gives someone another role, settling once it has or failed. Only administrators have it, and the crowns. */
  onChangeRole?: (person: DirectoryUser, role: PersonRole) => Promise<void>;
  /** Removes someone from the workspace, settling once it has or failed. Only administrators have it, and Delete. */
  onRemove?: (person: DirectoryUser) => Promise<void>;
  /** The heading that names the list. */
  "aria-labelledby"?: string;
}

/** Who's listed, administrators then members, as an administrator or a member sees them (presenters/accounts.rs). */
function groupsOf(people: People, administrator: boolean): [DirectoryUser[], DirectoryUser[]] {
  const listed = byName([...people.values()].filter((person) => person.status === "active" || (administrator && person.status === "banned")));
  return [listed.filter((person) => person.role === "administrator"), listed.filter((person) => person.role === "member")];
}

export function PeopleList({ people, myId, onChangeRole, onRemove, "aria-labelledby": labelledBy }: Props) {
  const administrator = onChangeRole !== undefined;
  const [administrators, members] = useMemo(() => groupsOf(people, administrator), [people, administrator]);
  // Roles on their way to the server, which their crowns show until it answers.
  const [changing, setChanging] = useState<ReadonlyMap<UserId, PersonRole>>(new Map());
  // The people being removed, whose Delete waits for the server's answer.
  const [removing, setRemoving] = useState<ReadonlySet<UserId>>(new Set());

  const changeRole = (person: DirectoryUser, role: PersonRole) => {
    setChanging((changing) => new Map(changing).set(person.id, role));
    void onChangeRole?.(person, role).finally(() =>
      setChanging((changing) => {
        const next = new Map(changing);
        next.delete(person.id);
        return next;
      }),
    );
  };

  const remove = (person: DirectoryUser) => {
    if (!onRemove || !confirm(CONFIRM_REMOVE)) return;
    setRemoving((removing) => new Set(removing).add(person.id));
    void onRemove(person).finally(() =>
      setRemoving((removing) => {
        const next = new Set(removing);
        next.delete(person.id);
        return next;
      }),
    );
  };

  const row = (person: DirectoryUser) => {
    const banned = person.status === "banned";
    const mine = person.id === myId;
    const role = changing.get(person.id) ?? person.role;
    return (
      <ListRow key={person.id} figure={<Avatar person={person} banned={banned} />} name={person.name}>
        {onChangeRole && !banned && (
          <RoleCrown
            administrator={role === "administrator"}
            mine={mine}
            // A change on its way waits for the server's answer before another.
            onChange={(administrator) => !changing.has(person.id) && changeRole(person, administrator ? "administrator" : "member")}
          />
        )}
        {onRemove && !banned && !mine && <RemoveButton name={person.name} removing={removing.has(person.id)} onClick={() => remove(person)} />}
        {mine && <MySettings />}
      </ListRow>
    );
  };

  // One list, so a row that changes group moves rather than being made again.
  return (
    <menu aria-labelledby={labelledBy} className="m-0 flex flex-col gap-x-[1ch] gap-y-4 px-[1ch] py-4">
      {[...administrators.map(row), administrators.length > 0 && members.length > 0 && <ListSeparator key="members" />, ...members.map(row)]}
    </menu>
  );
}

/**
 * Someone's avatar, linking to their page, as ember-rust's lists draw it at 3.75ch, dimmed under a cancel
 * mark when they're banned, which taps go through.
 */
function Avatar({ person, banned }: { person: DirectoryUser; banned: boolean }) {
  const avatar = <AvatarLink user={person} className={cn("size-[3.75ch]", banned && "[&>img]:opacity-50")} lazy />;
  if (!banned) return avatar;
  return (
    <span className="relative grid shrink-0">
      {avatar}
      <Cancel className="pointer-events-none absolute inset-0 size-full" />
    </span>
  );
}

/** ember-rust's My settings, a round `.btn.txt-small` with Campfire's pencil, on your own row, which opens your profile. */
function MySettings() {
  return (
    <PageLink href={PROFILE_PATH} className="grid size-9 shrink-0 place-items-center rounded-full border bg-background text-[0.8rem] touch:size-11">
      <Pencil className="size-[1.3em]" />
      <span className="sr-only">My settings</span>
    </PageLink>
  );
}

/**
 * ember-rust's Delete, a round `.btn.txt-small.btn--negative` with Campfire's minus, white on red, which
 * darkens under a mouse (buttons.css, zz-ember.css), and waits while a removal is on its way.
 */
function RemoveButton({ name, removing, onClick }: { name: string; removing: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={removing}
      onClick={onClick}
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-transparent bg-negative-button text-[0.8rem] touch:size-11 hover:not-active:brightness-70 disabled:pointer-events-none disabled:opacity-50"
    >
      <Minus tone="white" className="size-[1.3em]" />
      <span className="sr-only">Delete {name}</span>
    </button>
  );
}

/**
 * ember-rust's crown, a round `.btn.txt-small` around a checkbox, reversed while it's checked, for an
 * administrator (buttons.css). Its checkbox is hidden from keyboards and screen readers there, and only
 * visually hidden here, so it can be reached and pressed without a mouse.
 */
function RoleCrown({ administrator, mine, onChange }: { administrator: boolean; mine: boolean; onChange: (administrator: boolean) => void }) {
  return (
    <label
      className={cn(
        "relative grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border text-[0.8rem] touch:size-11",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-3 has-focus-visible:outline-foreground",
        administrator ? "bg-primary" : "bg-background",
        // Your own, as Campfire's disabled checkbox buttons are.
        mine && "pointer-events-none cursor-not-allowed opacity-50 grayscale contrast-50",
      )}
    >
      <span className="sr-only">Role: {administrator ? "Administrator" : "Member"}</span>
      <Crown tone={administrator ? "reversed" : "black"} className="size-[1.3em]" />
      <input type="checkbox" checked={administrator} disabled={mine} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
    </label>
  );
}
