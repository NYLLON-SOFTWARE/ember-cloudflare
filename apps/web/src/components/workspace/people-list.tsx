import { useMemo, useState } from "react";
import type { DirectoryUser, PersonRole, UserId } from "@ember/protocol";
import { Cancel, Crown } from "@/components/icons/campfire";
import type { People } from "@/hooks/use-directory";
import { byName } from "@/lib/people";
import { cn } from "@/lib/utils";
import { ListRow, ListSeparator } from "./list-row";
import { UserAvatar } from "./user-avatar";

// ember-rust's people on workspace settings (accounts/edit.html, accounts/users/_user.html): everyone but
// bots by name, administrators first, with a rule before the members when there are both. Administrators
// also see who's banned, dimmed under Campfire's cancel mark (avatars.css), and a crown on each active
// person's row that makes them an administrator or a member again.

interface Props {
  people: People;
  /** Whoever's looking, whose own crown can't be pressed, so there's always an administrator. */
  myId: UserId;
  /** Gives someone another role, settling once it has or failed. Only administrators have it, and the crowns. */
  onChangeRole?: (person: DirectoryUser, role: PersonRole) => Promise<void>;
  /** The heading that names the list. */
  "aria-labelledby"?: string;
}

/** Who's listed, administrators then members, as an administrator or a member sees them (presenters/accounts.rs). */
function groupsOf(people: People, administrator: boolean): [DirectoryUser[], DirectoryUser[]] {
  const listed = byName([...people.values()].filter((person) => person.status === "active" || (administrator && person.status === "banned")));
  return [listed.filter((person) => person.role === "administrator"), listed.filter((person) => person.role === "member")];
}

export function PeopleList({ people, myId, onChangeRole, "aria-labelledby": labelledBy }: Props) {
  const administrator = onChangeRole !== undefined;
  const [administrators, members] = useMemo(() => groupsOf(people, administrator), [people, administrator]);
  // Roles on their way to the server, which their crowns show until it answers.
  const [changing, setChanging] = useState<ReadonlyMap<UserId, PersonRole>>(new Map());

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

  const row = (person: DirectoryUser) => {
    const banned = person.status === "banned";
    const role = changing.get(person.id) ?? person.role;
    return (
      <ListRow key={person.id} figure={<Avatar person={person} banned={banned} />} name={person.name}>
        {onChangeRole && !banned && (
          <RoleCrown
            administrator={role === "administrator"}
            mine={person.id === myId}
            // A change on its way waits for the server's answer before another.
            onChange={(administrator) => !changing.has(person.id) && changeRole(person, administrator ? "administrator" : "member")}
          />
        )}
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

/** Someone's avatar, as ember-rust's lists draw it at 3.75ch, dimmed under a cancel mark when they're banned. */
function Avatar({ person, banned }: { person: DirectoryUser; banned: boolean }) {
  const avatar = <UserAvatar user={person} className={cn("size-[3.75ch]", banned && "opacity-50")} lazy />;
  if (!banned) return avatar;
  return (
    <span className="relative grid shrink-0">
      {avatar}
      <Cancel className="absolute inset-0 size-full" />
    </span>
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
