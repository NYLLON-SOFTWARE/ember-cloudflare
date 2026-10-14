import { useEffect, useState } from "react";
import type { NewRoom, Room, RoomIconName, User, UserId } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, newRoomPath, roomPath, WORKSPACE_SETTINGS_PATH, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { createRoom, fetchNewRoomForm, isSignedOut } from "@/lib/api";
import { AccessSwitch, CheckMark, RoomForm, withChoice } from "./room-form";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** What New room's name starts as, as in ember-rust (rooms/opens.rs). */
const DEFAULT_ROOM_NAME = "New room";

interface Props {
  /** Which of the two forms the address shows: a room for everyone, or a private one. */
  access: Access;
  me: User;
  /** Lists the room made, for the sidebar. The page then shows it, unless it was left first. */
  onCreated: (room: Room) => void;
  /** Says why something failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's New room pages (rooms/opens/new.html and rooms/closeds/new.html). The Everyone switch
 * swaps one for the other in place, keeping what's been filled in, as ember-rust's settings.js does.
 */
export function NewRoomPage({ access, me, onCreated, onFailed }: Props) {
  useTitle("New chat room");
  const [people, setPeople] = useState<User[] | null>(null);
  const [name, setName] = useState(DEFAULT_ROOM_NAME);
  const [icon, setIcon] = useState<RoomIconName | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();

  useEffect(() => {
    let stopped = false;
    fetchNewRoomForm().then(
      (form) => !stopped && setPeople(form.people),
      // A page left before its form loads only reports a session that's ended, which goes to sign in.
      (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [onFailed]);

  const save = () => {
    setSaving(true);
    // The private form lists its creator with a check mark and sends them as one of its members.
    const room: NewRoom = access === "open" ? { kind: access, name, icon: icon ?? "" } : { kind: access, name, icon: icon ?? "", memberIds: [me.id, ...chosen] };
    // An answer that comes after the page was left lists the room, but leaves the page shown then alone.
    createRoom(room).then(
      (room) => {
        onCreated(room);
        if (mounted.current) navigate(roomPath(room.id));
      },
      (error: unknown) => {
        // Once the page is left, only a session that's ended matters, which goes to sign in from any page.
        if (!mounted.current && !isSignedOut(error)) return;
        setSaving(false);
        onFailed(error);
      },
    );
  };

  return (
    <SettingsPage back={WORKSPACE_SETTINGS_PATH}>
      <Panel aria-busy={people === null}>
        <PageHeading title="New room">Create a place for a team, topic, or project.</PageHeading>
        {people && (
          <RoomForm
            canAdminister
            name={name}
            onNameChange={setName}
            icon={icon}
            onIconChange={setIcon}
            everyone={{ on: access === "open", onFlip: () => navigate(newRoomPath(access === "open" ? "closed" : "open"), { replace: true }) }}
            groups={[people]}
            mark={(person) =>
              access === "open" || person.id === me.id ? (
                <CheckMark />
              ) : (
                <AccessSwitch person={person} checked={chosen.has(person.id)} onCheckedChange={(checked) => setChosen((chosen) => withChoice(chosen, person, checked))} />
              )
            }
            saving={saving}
            onSave={save}
          />
        )}
      </Panel>
    </SettingsPage>
  );
}
