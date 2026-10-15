import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomChanges, RoomIconName, RoomId, RoomSettings, User, UserId } from "@ember/protocol";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, roomPath, roomSettingsPath, type Access } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { Trash } from "@/components/icons/campfire";
import { ApiError, changeRoom, deleteRoom, fetchRoomSettings, isSignedOut } from "@/lib/api";
import type { RoomAnswer } from "@/lib/room-list";
import { AccessSwitch, CheckMark, RoomForm, withChoice } from "./room-form";
import { PageHeading, Panel, SettingsPage } from "./settings-page";
import { UnsavedChanges } from "./unsaved-changes";

/** Whether `error` says the room isn't there for this person, as ember-rust's `set_room` finds rooms. */
export const isMissing = (error: unknown) => error instanceof ApiError && error.status === 404;

/** What Delete asks first, as ember-rust's `button_to_delete_room` does, in the browser's own dialog as Turbo asks it. */
export const CONFIRM_DELETE = "Are you sure you want to delete this room and all messages in it? This can’t be undone.";

const membersOf = (settings: RoomSettings) => new Set(settings.people.flatMap((person) => (person.member ? [person.id] : [])));

const sameMembers = (a: ReadonlySet<UserId>, b: ReadonlySet<UserId>) => a.size === b.size && [...a].every((id) => b.has(id));

interface Props {
  roomId: RoomId;
  /** Which of the two forms the address names. */
  access: Access;
  me: User;
  /** Where Go Back goes: the last room visited, as ember-rust's `link_back_to_last_room_visited` has it. */
  back: string;
  /**
   * Called as the room is saved or deleted, with what lists it, for the sidebar, as the server answers:
   * as saved, or gone once it's saved without this person, or deleted. The page then shows the room, or
   * goes home, unless it was left first.
   */
  askForRoom: () => (answer: RoomAnswer) => void;
  /** For a room this person isn't in, one that doesn't exist, or a DM. */
  onMissing: () => void;
  /** Says why something else failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's room settings (rooms/layouts/_edit.html with rooms/opens/edit.html or
 * rooms/closeds/edit.html). Whoever can change the room renames it, and with the Everyone switch,
 * which swaps one form for the other in place, opens it to everyone or makes it private to the people
 * whose switches are on; under the form, they can delete it. Leaving with changes asks first. Everyone
 * else sees its name and people, in the form for the room's kind.
 */
export function RoomSettingsPage({ roomId, access, me, back, askForRoom, onMissing, onFailed }: Props) {
  const [settings, setSettings] = useState<RoomSettings | null>(null);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<RoomIconName | null>(null);
  // Who the private form lets in, starting with the room's members, as ember-rust's does.
  const [chosen, setChosen] = useState<ReadonlySet<UserId>>(new Set());
  // Saving or deleting, either of which keeps both buttons from being pressed until it answers.
  const [busy, setBusy] = useState(false);
  // The form the page opened on, which the Everyone switch can move away from and back to, or the one
  // last saved.
  const [opened, setOpened] = useState(access);
  const roomForm = useRef<HTMLFormElement>(null);
  const mounted = useMounted();
  useTitle(settings && `Edit settings for ${settings.room.name}`);

  useEffect(() => {
    let stopped = false;
    fetchRoomSettings(roomId).then(
      (settings) => {
        if (stopped) return;
        setSettings(settings);
        setName(settings.room.name);
        setIcon(settings.room.icon);
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

  // An answer that comes after the page was left changes the sidebar, but leaves the page shown then alone.
  const failed = (error: unknown) => {
    // Once the page is left, only a session that's ended matters, which goes to sign in from any page.
    if (!mounted.current && !isSignedOut(error)) return;
    setBusy(false);
    if (isMissing(error)) onMissing();
    else onFailed(error);
  };

  /**
   * Saves the form, then lists the room as saved, or takes it out of the sidebar if it's saved without
   * this person, settling with whether it was. The form is then compared with what's saved.
   */
  const send = () => {
    const changes: RoomChanges = access === "open" ? { name, icon: icon ?? "", kind: access } : { name, icon: icon ?? "", kind: access, memberIds: [...chosen] };
    const leaving = access === "closed" && !chosen.has(me.id);
    const answered = askForRoom();
    return changeRoom(roomId, changes).then((room) => {
      answered(leaving ? { type: "gone", roomId: room.id } : { type: "saved", room });
      // An open room takes in everyone.
      setSettings((settings) => settings && { ...settings, room, people: settings.people.map((person) => ({ ...person, member: access === "open" || chosen.has(person.id) })) });
      setOpened(access);
      return leaving;
    });
  };

  const save = () => {
    setBusy(true);
    send().then((left) => {
      if (!mounted.current) return;
      // As ember-rust shows the room saved, which sends someone no longer in it home with its alert.
      if (left) onMissing();
      else navigate(roomPath(roomId));
    }, failed);
  };

  const remove = () => {
    if (!confirm(CONFIRM_DELETE)) return;
    setBusy(true);
    const answered = askForRoom();
    deleteRoom(roomId).then(() => {
      answered({ type: "gone", roomId });
      // As ember-rust goes home once the room's deleted, with no alert.
      if (mounted.current) navigate("/");
    }, failed);
  };

  const open = access === "open";
  const flip = () => navigate(roomSettingsPath(open ? "closed" : "open", roomId), { replace: true });
  // Whether the form differs from how it loaded or was last saved, the form its address names included,
  // as ember-rust's settings.js compares them. Saving or deleting isn't guarded.
  const changed =
    !!settings?.canAdminister &&
    !busy &&
    (name !== settings.room.name || icon !== settings.room.icon || access !== opened || (!open && !sameMembers(chosen, membersOf(settings))));
  // The Everyone switch moves between the room's two forms, keeping the draft.
  const stays = useCallback((path: string) => path === roomSettingsPath("open", roomId) || path === roomSettingsPath("closed", roomId), [roomId]);
  return (
    <SettingsPage back={back}>
      <Panel aria-busy={settings === null}>
        <PageHeading title="Room settings">Manage the room name, access, and members.</PageHeading>
        {settings && (
          <RoomForm
            canAdminister={settings.canAdminister}
            name={settings.canAdminister ? name : settings.room.name}
            onNameChange={setName}
            icon={icon}
            onIconChange={setIcon}
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
            saving={busy}
            onSave={save}
            ref={roomForm}
          />
        )}
      </Panel>
      {settings?.canAdminister && (
        <Panel>
          <DeleteButton label={`Delete ${settings.room.name}`} text={settings.room.name} disabled={busy} onClick={remove} />
        </Panel>
      )}
      <UnsavedChanges changed={changed} stays={stays} onSave={send} form={roomForm} />
    </SettingsPage>
  );
}

/**
 * ember-rust's `button_to_delete_room` (crates/views/src/rooms.rs), and a DM's Delete Ping
 * (rooms/directs/edit.html): Campfire's `.btn.btn--negative` (buttons.css), red with a white trash can in
 * both modes as zz-ember.css makes it, and 36px tall in a panel.
 */
export function DeleteButton({ label, text, disabled, onClick }: { label: string; text: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-9 max-w-full cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border border-transparent bg-negative-button px-[1.1em] py-[0.5em] text-start font-medium text-white touch:min-h-11 hover:not-active:brightness-70 disabled:pointer-events-none disabled:opacity-50 disabled:grayscale disabled:contrast-50"
    >
      <Trash tone="white" width={20} height={20} className="size-[1.3em] shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}
