import { useEffect, useState } from "react";
import type { Room, RoomId, RoomSettings } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, roomPath, roomSettingsPath, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, changeRoom, fetchRoomSettings } from "@/lib/api";
import { CheckMark, RoomForm } from "./room-form";
import { PageHeading, Panel, SettingsPage } from "./settings-page";

/** Whether `error` says the room isn't there for this person, as ember-rust's `set_room` finds rooms. */
const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

interface Props {
  roomId: RoomId;
  /** Which of the two forms the address names. */
  access: Access;
  /** Lists the room as saved, for the sidebar. The page then shows it, unless it was left first. */
  onSaved: (room: Room) => void;
  /** For a room this person isn't in, one that doesn't exist, or a DM. */
  onMissing: () => void;
  /** Says why something else failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's room settings (rooms/layouts/_edit.html with rooms/opens/edit.html or
 * rooms/closeds/edit.html). Whoever can change the room can rename it; everyone else sees its name
 * and people. A room shows at the address for its own kind, since it can't yet switch to the other.
 */
export function RoomSettingsPage({ roomId, access, onSaved, onMissing, onFailed }: Props) {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [name, setName] = useState("");
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
      },
      (error: unknown) => !stopped && (isMissing(error) ? onMissing() : onFailed(error)),
    );
    return () => void (stopped = true);
  }, [roomId, onMissing, onFailed]);

  const kind = settings?.room.kind;
  useEffect(() => {
    if (kind && kind !== access) navigate(roomSettingsPath(kind, roomId), { replace: true });
  }, [kind, access, roomId]);

  const save = () => {
    setSaving(true);
    // An answer that comes after the page was left lists the room, but leaves the page shown then alone.
    changeRoom(roomId, { name }).then(
      (room) => {
        onSaved(room);
        if (mounted.current) navigate(roomPath(room.id));
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setSaving(false);
        if (isMissing(error)) onMissing();
        else onFailed(error);
      },
    );
  };

  const open = kind === "open";
  return (
    <SettingsPage back={roomPath(roomId)}>
      <Panel aria-busy={settings === null}>
        <PageHeading title="Room settings">Manage the room name, access, and members.</PageHeading>
        {settings && (
          <RoomForm
            canAdminister={settings.canAdminister}
            name={settings.canAdminister ? name : settings.room.name}
            onNameChange={setName}
            everyone={open ? { on: true } : null}
            // A private room lists its members first, as ember-rust's does.
            groups={open ? [settings.people] : [settings.people.filter((p) => p.member), settings.people.filter((p) => !p.member)]}
            mark={(person) => settings.canAdminister && (open || person.member) && <CheckMark />}
            saving={saving}
            onSave={save}
          />
        )}
      </Panel>
    </SettingsPage>
  );
}
