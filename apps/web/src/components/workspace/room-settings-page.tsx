import { useEffect, useState } from "react";
import type { Room, RoomChanges, RoomId, RoomSettings, User, UserId } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, roomPath, roomSettingsPath, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, changeRoom, fetchRoomSettings, isSignedOut } from "@/lib/api";
import { AccessSwitch, CheckMark, RoomForm, withChoice } from "./room-form";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** Whether `error` says the room isn't there for this person, as ember-rust's `set_room` finds rooms. */
const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

const membersOf = (settings: RoomSettings) => new Set(settings.people.flatMap((person) => (person.member ? [person.id] : [])));

interface Props {
  roomId: RoomId;
  /** Which of the two forms the address names. */
  access: Access;
  me: User;
  /** Lists the room as saved, for the sidebar. The page then shows it, unless it was left first. */
  onSaved: (room: Room) => void;
  /** Takes a room saved without this person out of the sidebar. The page then goes home, unless it was left first. */
  onLeft: (roomId: RoomId) => void;
  /** For a room this person isn't in, one that doesn't exist, or a DM. */
  onMissing: () => void;
  /** Says why something else failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's room settings (rooms/layouts/_edit.html with rooms/opens/edit.html or
 * rooms/closeds/edit.html). Whoever can change the room renames it, and with the Everyone switch,
 * which swaps one form for the other in place, opens it to everyone or makes it private to the people
 * whose switches are on. Everyone else sees its name and people, in the form for the room's kind.
 */
export function RoomSettingsPage({ roomId, access, me, onSaved, onLeft, onMissing, onFailed }: Props) {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [name, setName] = useState("");
  // Who the private form lets in, starting with the room's members, as ember-rust's does.
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();
  useTitle(settings && `Edit settings for ${settings.room.name}`);

  useEffect(() => {
    let stopped = false;
    fetchRoomSettings(roomId).then(
      (settings) => {
        if (stopped) return;
        setSettings(settings);
        setName(settings.room.name);
        setChosen(membersOf(settings));
      },
      (error: unknown) => {
        // A page left before its settings load only reports a session that's ended, which goes to sign in.
        if (stopped && !isSignedOut(error)) return;
        if (isMissing(error)) onMissing();
        else onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [roomId, onMissing, onFailed]);

  // Whoever can change the room picks the form; anyone else sees the one for its kind. ember-rust shows
  // them either, which would describe the room wrongly.
  const kind = settings && !settings.canAdminister ? settings.room.kind : null;
  useEffect(() => {
    if (kind && kind !== access) navigate(roomSettingsPath(kind, roomId), { replace: true });
  }, [kind, access, roomId]);

  const save = () => {
    setSaving(true);
    const changes: RoomChanges = access === "open" ? { name, kind: access } : { name, kind: access, memberIds: [...chosen] };
    const leaving = access === "closed" && !chosen.has(me.id);
    // An answer that comes after the page was left changes the sidebar, but leaves the page shown then alone.
    changeRoom(roomId, changes).then(
      (room) => {
        if (leaving) onLeft(room.id);
        else onSaved(room);
        if (!mounted.current) return;
        // As ember-rust shows the room saved, which sends someone no longer in it home with its alert.
        if (leaving) onMissing();
        else navigate(roomPath(room.id));
      },
      (error: unknown) => {
        // Once the page is left, only a session that's ended matters, which goes to sign in from any page.
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        if (isMissing(error)) onMissing();
        else onFailed(error);
      },
    );
  };

  const open = access === "open";
  const flip = () => navigate(roomSettingsPath(open ? "closed" : "open", roomId), { replace: true });
  return (
    <SettingsPage back={roomPath(roomId)}>
      <Panel aria-busy={settings === null}>
        <PageHeading title="Room settings">Manage the room name, access, and members.</PageHeading>
        {settings && (
          <RoomForm
            canAdminister={settings.canAdminister}
            name={settings.canAdminister ? name : settings.room.name}
            onNameChange={setName}
            // The private form has the Everyone row only for whoever can change the room.
            everyone={settings.canAdminister ? { on: open, onFlip: flip } : open ? { on: true } : null}
            // A private room lists its members first, as ember-rust's does.
            groups={open ? [settings.people] : [settings.people.filter((p) => p.member), settings.people.filter((p) => !p.member)]}
            mark={(person) =>
              settings.canAdminister &&
              (open ? (
                <CheckMark />
              ) : (
                <AccessSwitch person={person} checked={chosen.has(person.id)} onCheckedChange={(checked) => setChosen((chosen) => withChoice(chosen, person, checked))} />
              ))
            }
            saving={saving}
            onSave={save}
          />
        )}
      </Panel>
    </SettingsPage>
  );
}
