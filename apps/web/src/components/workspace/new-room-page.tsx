import { useEffect, useRef, useState } from "react";
import type { Me, NewRoom, ParentChoice, Room, RoomIconName, RoomId, User, UserId } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, newRoomPath, roomPath, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { ApiError, createRoom, fetchNewRoomForm, isSignedOut } from "@/lib/api";
import { peopleIn } from "@/lib/sub-rooms";
import { parentChoice } from "./parent-picker";
import { AccessSwitch, CheckMark, RoomForm, withChoice } from "./room-form";
import { workspaceSectionPath } from "./settings-navigation";
import { PageHeading, Panel, SettingsPage } from "./settings-page";
import { UnsavedChanges } from "./unsaved-changes";

/** What New room's name starts as. */
const DEFAULT_ROOM_NAME = "New room";

/** The Everyone switch moves between New room's two forms, keeping the draft. */
const isNewRoomPath = (path: string) => path === newRoomPath("open") || path === newRoomPath("closed");

/** The parent the address asks for, as New sub-room on a room in workspace settings does. */
const askedParent = (): RoomId | null => new URLSearchParams(location.search).get("parent") || null;

interface Props {
  /** Which of the two forms the address shows: a room for everyone, or a private one. */
  access: Access;
  me: Me;
  /** Lists the room made, for the sidebar. The page then shows it, unless it was left first. */
  onCreated: (room: Room) => void;
  /** Says why something failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The New room pages, for an open room and a private one. The Everyone switch swaps one for the other in
 * place, keeping what's been filled in, and leaving with anything filled in asks first. While only
 * administrators can create rooms, anyone else is sent to workspace settings with an alert.
 */
export function NewRoomPage({ access, me, onCreated, onFailed }: Props) {
  const [people, setPeople] = useState<User[] | null>(null);
  const [parents, setParents] = useState<ParentChoice[]>([]);
  // The room it goes under, kept as the Everyone switch moves between the forms.
  const [asked] = useState(askedParent);
  const [parentId, setParentId] = useState<RoomId | null>(asked);
  const parent = parentChoice(parents, parentId);
  useTitle(parent ? `New sub-room in ${parent.name}` : "New chat room");
  const [name, setName] = useState(DEFAULT_ROOM_NAME);
  const [icon, setIcon] = useState<RoomIconName | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  // A private room is its maker's too, as Slack's are, unless an administrator making it for others takes
  // themselves out before it's made.
  const [withMe, setWithMe] = useState(true);
  const inRoom = (person: User) => (person.id === me.id ? withMe || !me.administrator : chosen.has(person.id));
  const [saving, setSaving] = useState(false);
  // The room the unsaved changes dialog's Save made, while the app goes on to where the person was going.
  const [created, setCreated] = useState<Room | null>(null);
  // The form the page opened on, which the Everyone switch can move away from and back to.
  const [opened] = useState(access);
  const roomForm = useRef<HTMLFormElement>(null);
  const flash = useFlash();
  const mounted = useMounted();

  useEffect(() => {
    let stopped = false;
    fetchNewRoomForm().then(
      (form) => {
        if (stopped) return;
        setPeople(form.people);
        setParents(form.parents);
      },
      (error: unknown) => {
        // A page left before its form loads only reports a session that's ended, which goes to sign in.
        if (stopped && !isSignedOut(error)) return;
        if (!(error instanceof ApiError && error.status === 403)) return onFailed(error);
        // To Rooms and permissions, which says who makes rooms.
        navigate(workspaceSectionPath("channel-settings"), { replace: true });
        flash("alert", error.message);
      },
    );
    return () => void (stopped = true);
  }, [flash, onFailed]);

  /** Creates the room and lists it in the sidebar. */
  const send = () => {
    // The private form lists its creator, in it, and sends them as one of its members.
    const under = parent ? { parentId: parent.id } : {};
    // Only people in its parent can be in a sub-room.
    const memberIds = peopleIn(people ?? [], parent).flatMap((person) => (inRoom(person) ? [person.id] : []));
    const room: NewRoom = access === "open" ? { kind: access, name, icon: icon ?? "", ...under } : { kind: access, name, icon: icon ?? "", ...under, memberIds };
    return createRoom(room).then((room) => {
      onCreated(room);
      setCreated(room);
      return room;
    });
  };

  const save = () => {
    // A room made already isn't made twice: Save shows it, as it does a room it makes.
    if (created) return navigate(roomPath(created.id));
    setSaving(true);
    // An answer that comes after the page was left lists the room, but leaves the page shown then alone.
    send().then(
      (room) => {
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

  // Anything filled in, or the other form, which the page didn't open on, until the room's made.
  const changed =
    people !== null &&
    !saving &&
    !created &&
    (name !== DEFAULT_ROOM_NAME || icon !== null || access !== opened || parentId !== asked || (access === "closed" && (chosen.size > 0 || !withMe)));
  return (
    // Go Back returns to Rooms and permissions.
    <SettingsPage back={workspaceSectionPath("channel-settings")}>
      <Panel aria-busy={people === null}>
        <PageHeading title={parent ? "New sub-room" : "New room"}>
          {parent ? `Create a room inside ${parent.name} for some or all of its people.` : "Create a place for a team, topic, or project."}
        </PageHeading>
        {people && (
          <RoomForm
            canAdminister
            name={name}
            onNameChange={setName}
            icon={icon}
            onIconChange={setIcon}
            everyone={{
              on: access === "open",
              onFlip: () => navigate(newRoomPath(access === "open" ? "closed" : "open"), { replace: true }),
              ...(parent && { label: `Everyone in ${parent.name}` }),
            }}
            parent={{ value: parent?.id ?? null, choices: parents, onChange: setParentId }}
            groups={[peopleIn(people, parent)]}
            mark={(person) =>
              access === "open" || (person.id === me.id && !me.administrator) ? (
                <CheckMark />
              ) : (
                <AccessSwitch
                  person={person}
                  checked={inRoom(person)}
                  onCheckedChange={(checked) => (person.id === me.id ? setWithMe(checked) : setChosen((chosen) => withChoice(chosen, person, checked)))}
                />
              )
            }
            saving={saving}
            onSave={save}
            ref={roomForm}
          />
        )}
      </Panel>
      {/* Should the page stay after the dialog's Save, as it does when signing out fails, it shows the room
          made, as its own Save does, rather than a form for another. */}
      <UnsavedChanges changed={changed} stays={isNewRoomPath} onSave={send} onStayAfterSave={(room) => navigate(roomPath(room.id))} form={roomForm} />
    </SettingsPage>
  );
}
