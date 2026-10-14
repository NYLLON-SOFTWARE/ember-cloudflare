import { useEffect, useState } from "react";
import type { Room, User, UserId } from "@ember/protocol";
import { navigate, newRoomPath, WORKSPACE_SETTINGS_PATH, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { createRoom, fetchNewRoomForm } from "@/lib/api";
import { AccessSwitch, CheckMark, RoomForm } from "./room-form";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** What New room's name starts as, as in ember-rust (rooms/opens.rs). */
const DEFAULT_ROOM_NAME = "New room";

interface Props {
  /** Which of the two forms the address shows: a room for everyone, or a private one. */
  access: Access;
  me: User;
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
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let stopped = false;
    fetchNewRoomForm().then(
      (form) => !stopped && setPeople(form.people),
      (error: unknown) => !stopped && onFailed(error),
    );
    return () => void (stopped = true);
  }, [onFailed]);

  const choose = (person: User, checked: boolean) =>
    setChosen((chosen) => {
      const next = new Set(chosen);
      if (checked) next.add(person.id);
      else next.delete(person.id);
      return next;
    });

  const save = () => {
    setSaving(true);
    // The private form lists its creator with a check mark and sends them as one of its members.
    const room = access === "open" ? { kind: access, name } : { kind: access, name, memberIds: [me.id, ...chosen] };
    createRoom(room).then(onCreated, (error) => {
      setSaving(false);
      onFailed(error);
    });
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
            everyone={{ on: access === "open", onFlip: () => navigate(newRoomPath(access === "open" ? "closed" : "open"), { replace: true }) }}
            groups={[people]}
            mark={(person) =>
              access === "open" || person.id === me.id ? (
                <CheckMark />
              ) : (
                <AccessSwitch person={person} checked={chosen.has(person.id)} onCheckedChange={(checked) => choose(person, checked)} />
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
