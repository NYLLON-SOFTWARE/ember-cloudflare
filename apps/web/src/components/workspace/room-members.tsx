import { useEffect, useState } from "react";
import type { Me, RoomPerson, RoomSettings, User } from "@ember/protocol";
import { User as UserIcon } from "@/components/icons/iconoir";
import { fetchRoomSettings, isSignedOut, type Room } from "@/lib/api";

// Who's in a room, after Slack's channel details: a person and how many are in it at the top of the room,
// which opens a dialog listing them, each going to their page, with Add people for whoever can change who's
// in a private room. A DM lists the people in it, as its room keeps them.
import { preloadRarePages, RarePage } from "./rare-pages";

interface Props {
  room: Room;
  me: Me;
  /** Who's in the room now, whose rows get a presence dot. */
  present: User[];
  /** Says why the dialog couldn't add people, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/** What the dialog lists: the people in the room, and whether you can add people to it. */
export interface Members {
  people: User[];
  /** Everyone not in it, whom Add people offers, or null where nobody can be added. */
  addable: User[] | null;
  settings: RoomSettings | null;
}

export const isIn = (person: RoomPerson) => person.member;

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
        onPointerEnter={preloadRarePages}
        onFocus={preloadRarePages}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-2 text-[14px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground touch:h-11"
      >
        <UserIcon className="size-[18px]" />
        {count !== undefined && <span>{count}</span>}
      </button>
      {open && (
        <RarePage
          show={({ MembersDialog }) => (
            <MembersDialog room={room} me={me} present={present} members={members} onClose={() => setOpen(false)} onAdded={setSettings} onFailed={onFailed} />
          )}
          loading={null}
          onFailed={onFailed}
        />
      )}
    </>
  );
}
