import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { Me, RoomPerson, RoomSettings, User } from "@ember/protocol";
import { ArrowLeft, ChatBubbleEmpty, Lock, Search as SearchIcon, User as UserIcon, UserPlus } from "@/components/icons/iconoir";
import { RoomIcon } from "@/components/icons/room-icon";
import { PageLink } from "@/components/page-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PeopleContext, useNameOf } from "@/hooks/use-directory";
import { personPath } from "@/hooks/use-route";
import { changeRoom, fetchRoomSettings, isSignedOut, type Room } from "@/lib/api";
import { cn } from "@/lib/utils";
import { AgentBadge, isAgent } from "./agent-badge";
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

/**
 * The people in `room`, from its settings, which are asked for as it opens and each time `ask` is called,
 * and `added` takes in once Add people saves them.
 */
function useMembers(room: Room, onFailed: (error: unknown) => void) {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const shared = room.kind !== "direct";
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
  return { members: membersOf(room, settings), ask: () => setAsked((asked) => asked + 1), added: setSettings };
}

/** A private room without an icon of its own has a lock where an open one has `#`, as the sidebar does. */
function ConversationIcon({ room }: { room: Room }) {
  if (room.kind === "direct") return <ChatBubbleEmpty className="size-5 shrink-0" />;
  if (room.kind === "closed" && room.icon === null) return <Lock aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />;
  return <RoomIcon icon={room.icon} size={22} className="shrink-0 text-[23px] text-muted-foreground" />;
}

/** The button at the top of a room: a person and how many are in the room, which opens who they are. */
export function MembersButton({ room, me, present, onFailed }: Props) {
  const { members, ask, added } = useMembers(room, onFailed);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const count = members?.people.length;
  return (
    <>
      <button
        ref={button}
        type="button"
        title="View members"
        aria-label={count === undefined ? "View members" : `View members, ${countOf(count)}`}
        onClick={() => {
          setOpen(true);
          ask();
        }}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-lg px-2 text-[14px] font-medium hover:bg-hover touch:h-11 touch:min-w-11"
      >
        <UserIcon className="size-5" />
        {count !== undefined && <span>{count}</span>}
      </button>
      {open && (
        <MembersDialog
          room={room}
          me={me}
          present={present}
          members={members}
          opener={button}
          onClose={() => setOpen(false)}
          onAdded={added}
          onFailed={onFailed}
        />
      )}
    </>
  );
}

/**
 * The room's members as a page of its own, with Back on the left, for a phone to push from the room's
 * details: the room and how many are in it, then the same list the dialog has.
 */
export function MembersPage({ room, me, present, onBack, onFailed }: Props & { onBack: () => void }) {
  const { members, added } = useMembers(room, onFailed);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background pb-[env(safe-area-inset-bottom)]">
      <header className="flex items-center gap-1 border-b px-1.5 pt-[env(safe-area-inset-top)]">
        <button type="button" onClick={onBack} aria-label="Back" className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-hover">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 py-1.5">
          <h1 className="truncate text-[17px] font-semibold">Members</h1>
          <p className="text-[13px] text-muted-foreground">{members ? countOf(members.people.length) : " "}</p>
        </div>
      </header>
      <MembersList me={me} present={present} members={members} onPicked={() => {}} onAdded={added} onFailed={onFailed} />
    </div>
  );
}

interface DialogProps {
  room: Room;
  me: Me;
  present: User[];
  members: Members | null;
  /** The button that opened it, which gets focus back as it closes. */
  opener: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onAdded: (settings: RoomSettings) => void;
  onFailed: (error: unknown) => void;
}

const countOf = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/** A row, 54px tall, a bot's as a person's, with the hover's fill for keyboard focus too. */
const ROW = "flex min-h-[54px] items-center gap-3 rounded-lg px-2 py-1.5 text-start outline-none hover:bg-hover focus-visible:bg-hover";
/** What the list says in place of rows, on the rows' column. */
const NOTE = "px-2 py-3 text-sm text-muted-foreground";
/** The dialog's own ×, a 36px square, 44px for fingers, at the title, with the hover's fill. */
const CLOSE =
  "[&>[data-slot=dialog-close]]:top-5 [&>[data-slot=dialog-close]]:right-5 [&>[data-slot=dialog-close]]:grid [&>[data-slot=dialog-close]]:size-9 [&>[data-slot=dialog-close]]:place-items-center [&>[data-slot=dialog-close]]:rounded-lg [&>[data-slot=dialog-close]]:opacity-100 [&>[data-slot=dialog-close]]:hover:bg-hover [&>[data-slot=dialog-close]]:touch:size-11 [&>[data-slot=dialog-close]_svg]:size-5";

function MembersDialog({ room, me, present, members, opener, onClose, onAdded, onFailed }: DialogProps) {
  const nameOf = useNameOf();
  const title = room.kind === "direct" ? room.members.filter((member) => member.id !== me.id).map(nameOf).join(", ") || nameOf(me) : room.name;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus({ preventScroll: true });
        }}
        className={cn(
          // As tall as it opens whatever the search leaves, and held at the top, so the rows stay put under the pointer.
          "top-[10dvh] flex h-[min(640px,80dvh)] translate-y-0 flex-col gap-0 p-0 sm:max-w-[560px]",
          // A phone's is the whole screen.
          "max-md:inset-0 max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
          CLOSE,
        )}
      >
        <div className="border-b px-6 pt-5 pb-4 pr-16 max-md:px-4">
          <div className="flex items-center gap-2.5">
            <ConversationIcon room={room} />
            <DialogTitle className="truncate text-xl font-bold">{title}</DialogTitle>
          </div>
          <DialogDescription className="mt-0.5 text-[14px] text-muted-foreground">{members ? countOf(members.people.length) : " "}</DialogDescription>
        </div>
        <MembersList me={me} present={present} members={members} onPicked={onClose} onAdded={onAdded} onFailed={onFailed} />
      </DialogContent>
    </Dialog>
  );
}

interface ListProps {
  me: Me;
  present: User[];
  members: Members | null;
  /** Called as a person is picked, whose page opens. */
  onPicked: () => void;
  onAdded: (settings: RoomSettings) => void;
  onFailed: (error: unknown) => void;
}

/** Find people, Add people where you can, and the people, which the dialog and the members page share. */
function MembersList({ me, present, members, onPicked, onAdded, onFailed }: ListProps) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  // ↓ from the search goes into the people, ↑ and ↓ go along them, and ↑ from the first back to the search.
  // Enter opens the one focused, or from the search, the only one it finds.
  const moveThroughList = (event: KeyboardEvent<HTMLDivElement>) => {
    const search = list.current?.querySelector<HTMLInputElement>("input[type=search]");
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[aria-label=Members] a") ?? [])];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const inSearch = document.activeElement === search;
    if (event.key === "Enter" && inSearch && rows.length === 1) rows[0]!.click();
    else if (event.key === "ArrowDown" && (inSearch || at >= 0)) rows[inSearch ? 0 : Math.min(at + 1, rows.length - 1)]?.focus();
    else if (event.key === "ArrowUp" && at >= 0) (at === 0 ? search : rows[at - 1])?.focus();
    else return;
    event.preventDefault();
  };
  if (adding && members?.addable && members.settings)
    return (
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
    );
  return (
    <div ref={list} onKeyDown={moveThroughList} className="flex min-h-0 flex-1 flex-col gap-2 px-4 pt-3 pb-4 max-md:px-2">
      <FindPeople value={q} onChange={setQ} />
      {members?.addable && (
        <button type="button" onClick={() => setAdding(true)} className={cn(ROW, "font-medium")}>
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
            <UserPlus className="size-5" />
          </span>
          Add people
        </button>
      )}
      {members ? <PeopleList people={members.people} me={me} present={present} q={q} onPicked={onPicked} /> : <p className={NOTE}>Loading…</p>}
    </div>
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
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground max-md:text-base [&::-webkit-search-cancel-button]:appearance-none"
      />
    </label>
  );
}

/** Whether someone's a bot or an AI agent, as the people directory lists them, whom the list marks. */
function useIsBot(): (user: User) => boolean {
  const directory = useContext(PeopleContext);
  return useCallback(
    (user: User) => {
      const listed = directory.get(user.id);
      return listed?.role === "bot" || isAgent(listed ?? user);
    },
    [directory],
  );
}

/** `people` whose names hold each of `q`'s words, in any order, by their names now: you first, and bots last. */
function usePeopleFound(people: User[], meId: string, q: string): User[] {
  const nameOf = useNameOf();
  const isBot = useIsBot();
  return useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const rank = (user: User) => (user.id === meId ? 0 : isBot(user) ? 2 : 1);
    return people
      .filter((person) => words.every((word) => nameOf(person).toLowerCase().includes(word)))
      .sort((a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)));
  }, [people, meId, q, nameOf, isBot]);
}

/**
 * The people in the room, each going to their profile, which closes the dialog: focus goes back to the
 * button that opened it as the profile opens beside the room, or in the page's place.
 */
function PeopleList({ people, me, present, q, onPicked }: { people: User[]; me: Me; present: User[]; q: string; onPicked: () => void }) {
  const directory = useContext(PeopleContext);
  const nameOf = useNameOf();
  const here = useMemo(() => new Set(present.map(({ id }) => id)), [present]);
  const found = usePeopleFound(people, me.id, q);
  const isBot = useIsBot();
  if (found.length === 0) return <p className={NOTE}>No matches</p>;
  return (
    <ul aria-label="Members" className="min-h-0 flex-1 overflow-y-auto">
      {found.map((person) => {
        const bio = directory.get(person.id)?.bio;
        return (
          <li key={person.id}>
            <PageLink href={personPath(person.id)} onClick={onPicked} className={ROW}>
              <span className="relative shrink-0">
                <UserAvatar user={person} square className="size-9" />
                {here.has(person.id) && <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-background bg-positive" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold text-foreground">
                  {nameOf(person)}
                  {person.id === me.id && <span className="font-normal text-muted-foreground"> (you)</span>}
                  {isBot(person) && <AgentBadge label={isAgent(directory.get(person.id) ?? person) ? "Agent" : "Bot"} />}
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
        <button type="button" onClick={onBack} aria-label="Back to members" className="-ml-2 grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-hover touch:size-11">
          <ArrowLeft className="size-5" />
        </button>
        <h3 className="text-[15px] font-semibold">Add people</h3>
      </div>
      <FindPeople value={q} onChange={setQ} />
      {addable.length === 0 ? (
        <p className={NOTE}>Everyone’s in here</p>
      ) : (
        <ul aria-label="People to add" className="min-h-0 flex-1 overflow-y-auto">
          {found.map((person) => (
            <li key={person.id}>
              <label htmlFor={`${id}-${person.id}`} className={cn(ROW, "cursor-pointer has-focus-visible:bg-hover")}>
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
                <UserAvatar user={person} square className="size-9 shrink-0" />
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
