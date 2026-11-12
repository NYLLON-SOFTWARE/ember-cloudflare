import { useContext, useEffect, useId, useMemo, useState } from "react";
import type { Me, RoomPerson, RoomSettings, User } from "@ember/protocol";
import { ArrowLeft, ChatBubbleEmpty, Search as SearchIcon, User as UserIcon, UserPlus } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { personPath } from "@/hooks/use-route";
import { changeRoom, fetchRoomSettings, isSignedOut, type Room } from "@/lib/api";
import { cn } from "@/lib/utils";
import { UserAvatar } from "./user-avatar";

// Who's in a room, after Slack's channel details: a person and how many are in it at the top of the room,
// which opens a dialog listing them, each going to their page, with Add people for whoever can change who's
// in a private room. A DM lists the people in it, as its room keeps them.

interface Props {
  room: Room;
  me: Me;
  /** Who's in the room now, whose rows get a presence dot. */
  present: User[];
  /** Says why the dialog couldn't add people, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** What the dialog lists: the people in the room, and whether you can add people to it. */
interface Members {
  people: User[];
  /** Everyone not in it, whom Add people offers, or null where nobody can be added. */
  addable: User[] | null;
  settings: RoomSettings | null;
}

const isIn = (person: RoomPerson) => person.member;

function membersOf(room: Room, settings: RoomSettings | null): Members | null {
  if (room.kind === "direct") return { people: room.members, addable: null, settings: null };
  if (!settings) return null;
  const closed = settings.room.kind === "closed";
  return {
    people: settings.people.filter(isIn),
    addable: closed && settings.canAdminister ? settings.people.filter((person) => !isIn(person)) : null,
    settings,
  };
}

/** The button at the top of a room: a person and how many are in the room, which opens who they are. */
export function MembersButton({ room, me, present, onFailed }: Props) {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [open, setOpen] = useState(false);
  const shared = room.kind !== "direct";
  // A room's people come with its settings, asked for when it opens and each time the dialog does.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    if (!shared) return;
    let stopped = false;
    fetchRoomSettings(room.id).then(
      // Only settings that list the room's people count them.
      (settings) => !stopped && setSettings(settings?.room && Array.isArray(settings.people) ? settings : null),
      (error: unknown) => isSignedOut(error) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [room.id, shared, asked, onFailed]);
  const members = membersOf(room, settings);
  const count = members?.people.length;
  return (
    <>
      <button
        type="button"
        title="View members"
        aria-label={count === undefined ? "View members" : `View members, ${count} ${count === 1 ? "member" : "members"}`}
        onClick={() => {
          setOpen(true);
          setAsked((asked) => asked + 1);
        }}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[14px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground touch:h-11"
      >
        <UserIcon className="size-[18px]" />
        {count !== undefined && <span>{count}</span>}
      </button>
      {open && (
        <MembersDialog
          room={room}
          me={me}
          present={present}
          members={members}
          onClose={() => setOpen(false)}
          onAdded={setSettings}
          onFailed={onFailed}
        />
      )}
    </>
  );
}

interface DialogProps {
  room: Room;
  me: Me;
  present: User[];
  members: Members | null;
  onClose: () => void;
  onAdded: (settings: RoomSettings) => void;
  onFailed: (error: unknown) => void;
}

/** A row, 44px tall at least for fingers. */
const ROW = "flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-hover";

function MembersDialog({ room, me, present, members, onClose, onAdded, onFailed }: DialogProps) {
  const nameOf = useNameOf();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const title = room.kind === "direct" ? room.members.filter((member) => member.id !== me.id).map(nameOf).join(", ") || nameOf(me) : room.name;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[min(640px,calc(100dvh-4rem))] flex-col gap-0 p-0 sm:max-w-[560px]",
          // A phone's is the whole screen.
          "max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
          "[&>[data-slot=dialog-close]]:top-5 [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:place-items-center [&>[data-slot=dialog-close]]:touch:size-11 [&>[data-slot=dialog-close]_svg]:size-5",
        )}
      >
        <div className="flex items-center gap-2.5 border-b px-6 pt-5 pb-4 pr-16 max-md:px-4">
          {room.kind === "direct" ? <ChatBubbleEmpty className="size-5 shrink-0" /> : <RoomIcon icon={room.icon} size={22} className="shrink-0 text-[23px] text-muted-foreground" />}
          <DialogTitle className="truncate text-xl font-bold">{title}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Who’s in this conversation.</DialogDescription>
        {adding && members?.addable && members.settings ? (
          <AddPeople
            settings={members.settings}
            addable={members.addable}
            onBack={() => setAdding(false)}
            onAdded={(settings) => {
              onAdded(settings);
              setAdding(false);
            }}
            onFailed={onFailed}
          />
        ) : (
          <>
            <div className="flex items-center gap-4 border-b px-6 max-md:px-4">
              <span className="border-b-2 border-foreground py-2.5 text-[14px] font-semibold">
                Members{members ? ` ${members.people.length}` : ""}
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3 pb-4 max-md:px-2">
              <FindPeople value={q} onChange={setQ} />
              {members?.addable && (
                <button type="button" onClick={() => setAdding(true)} className={cn(ROW, "font-medium")}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
                    <UserPlus className="size-5" />
                  </span>
                  Add people
                </button>
              )}
              {members ? <PeopleList people={members.people} me={me} present={present} q={q} /> : <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FindPeople({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  return (
    <label className="mx-2 flex min-h-10 items-center gap-2 rounded-[9px] border bg-background px-3 focus-within:border-muted-foreground touch:min-h-11">
      <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Find people"
        aria-label="Find people"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground max-md:text-base"
      />
    </label>
  );
}

/** `people` whose names hold `q`, by their names now, you first. */
function usePeopleFound(people: User[], meId: string, q: string): User[] {
  const nameOf = useNameOf();
  return useMemo(() => {
    const words = q.trim().toLowerCase();
    return people
      .filter((person) => !words || nameOf(person).toLowerCase().includes(words))
      .sort((a, b) => (a.id === meId ? -1 : b.id === meId ? 1 : nameOf(a).localeCompare(nameOf(b))));
  }, [people, meId, q, nameOf]);
}

function PeopleList({ people, me, present, q }: { people: User[]; me: Me; present: User[]; q: string }) {
  const directory = useContext(PeopleContext);
  const nameOf = useNameOf();
  const here = useMemo(() => new Set(present.map(({ id }) => id)), [present]);
  const found = usePeopleFound(people, me.id, q);
  if (found.length === 0) return <p className="p-3 text-sm text-muted-foreground">Nobody by that name is in here.</p>;
  return (
    <ul aria-label="Members" className="min-h-0 flex-1 overflow-y-auto">
      {found.map((person) => {
        const bio = directory.get(person.id)?.bio;
        return (
          <li key={person.id}>
            <PageLink href={personPath(person.id)} className={ROW}>
              <span className="relative shrink-0">
                <UserAvatar user={person} className="size-9" />
                {here.has(person.id) && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background bg-positive" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {nameOf(person)}
                  {person.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  {here.has(person.id) && <span className="sr-only">, here now</span>}
                </span>
                {bio && <span className="block truncate text-[13px] text-muted-foreground">{bio}</span>}
              </span>
            </PageLink>
          </li>
        );
      })}
    </ul>
  );
}

/** Add people to a private room: everyone not in it, to tick, then Add, as the room's settings save its members. */
function AddPeople({ settings, addable, onBack, onAdded, onFailed }: { settings: RoomSettings; addable: User[]; onBack: () => void; onAdded: (settings: RoomSettings) => void; onFailed: (error: unknown) => void }) {
  const nameOf = useNameOf();
  const id = useId();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const found = usePeopleFound(addable, "", q);
  const add = async () => {
    setSaving(true);
    setError(null);
    const memberIds = [...settings.people.filter(isIn).map(({ id }) => id), ...chosen];
    try {
      const room = await changeRoom(settings.room.id, { kind: "closed", memberIds });
      onAdded({ ...settings, room, people: settings.people.map((person) => ({ ...person, member: person.member || chosen.has(person.id) })) });
    } catch (failure) {
      setSaving(false);
      if (failure instanceof Error && !isSignedOut(failure)) setError(failure.message);
      else onFailed(failure);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3 pb-4 max-md:px-2">
      <div className="flex items-center gap-2 px-2">
        <button type="button" onClick={onBack} aria-label="Back to members" className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-hover touch:size-11">
          <ArrowLeft className="size-5" />
        </button>
        <h3 className="text-[15px] font-semibold">Add people</h3>
      </div>
      <FindPeople value={q} onChange={setQ} />
      {addable.length === 0 ? (
        <p className="p-3 text-sm text-muted-foreground">Everyone is in here already.</p>
      ) : (
        <ul aria-label="People to add" className="min-h-0 flex-1 overflow-y-auto">
          {found.map((person) => (
            <li key={person.id}>
              <label htmlFor={`${id}-${person.id}`} className={cn(ROW, "cursor-pointer")}>
                <input
                  id={`${id}-${person.id}`}
                  type="checkbox"
                  checked={chosen.has(person.id)}
                  onChange={(event) =>
                    setChosen((chosen) => {
                      const next = new Set(chosen);
                      if (event.target.checked) next.add(person.id);
                      else next.delete(person.id);
                      return next;
                    })
                  }
                  className="size-4 shrink-0 accent-foreground"
                />
                <UserAvatar user={person} className="size-9 shrink-0" />
                <span className="truncate text-[15px] font-medium">{nameOf(person)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="px-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 px-2 pt-1">
        <Button type="button" variant="outline" onClick={onBack}>
          Cancel
        </Button>
        <Button type="button" disabled={chosen.size === 0 || saving} onClick={() => void add()}>
          {saving ? "Adding…" : chosen.size > 1 ? `Add ${chosen.size} people` : "Add"}
        </Button>
      </div>
    </div>
  );
}
