import { useEffect, useRef, useState } from "react";
import type { Me, RoomPerson, RoomSettings, User } from "@ember/protocol";
import { User as UserIcon } from "@/components/icons/iconoir";
import { fetchRoomSettings, isSignedOut, type Room } from "@/lib/api";
import { preloadRarePages, RarePage } from "./rare-pages";

// Who's in a room, after Slack's channel details: a person and how many are in it at the top of the room,
// which opens a dialog listing them, each going to their page, with Add people for whoever can change who's
// in a private room. A DM lists the people in it, as its room keeps them.

export interface Props {
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

/** How many people are in a room, as the button and its dialog say it. */
export const countOf = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/** The button at the top of a room: a person and how many are in the room, which opens who they are. */
/**
 * The people in `room`, from its settings, which are asked for as it opens and each time `ask` is called,
 * and `added` takes in once Add people saves them: the button's, and the members page's.
 */
export function useMembers(room: Room, onFailed: (error: unknown) => void) {
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
        onPointerEnter={preloadRarePages}
        onFocus={preloadRarePages}
        className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-[14px] font-medium hover:bg-hover touch:h-11 touch:min-w-11 justify-center"
      >
        <UserIcon className="size-5" />
        {count !== undefined && <span>{count}</span>}
      </button>
      {open && (
        <RarePage
          show={({ MembersDialog }) => (
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
          loading={null}
          onFailed={onFailed}
        />
      )}
    </>
  );
}
