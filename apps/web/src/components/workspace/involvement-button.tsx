import { useId, useState, type ComponentType } from "react";
import type { Involvement, Room, RoomId } from "@ember/protocol";
import {
  NotificationBellEverything,
  NotificationBellInvisible,
  NotificationBellMentions,
  NotificationBellNothing,
  type CampfireIconProps,
} from "@/components/icons/campfire";
import { useMounted } from "@/hooks/use-mounted";
import { isSignedOut, setInvolvement } from "@/lib/api";
import { INVOLVEMENT_LABELS, nextInvolvement } from "@/lib/involvement";
import { cn } from "@/lib/utils";

/** Campfire's bell for each level (notification-bell-*.svg). */
const BELLS: Record<Involvement, ComponentType<CampfireIconProps>> = {
  mentions: NotificationBellMentions,
  everything: NotificationBellEverything,
  nothing: NotificationBellNothing,
  invisible: NotificationBellInvisible,
};

interface Props {
  room: Room;
  /** Your level in the room, as the sidebar's list says. */
  involvement: Involvement;
  /** Called with the room and the level the server answers, once a press has saved it. */
  onSaved: (roomId: RoomId, involvement: Involvement) => void;
  /** Says why a save failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  className?: string;
}

/**
 * ember-rust's notification bell (`button_to_change_involvement`, helpers/rooms.rs): Campfire's bell for
 * your level in a room, as a checkbox that's always checked, named for what the level does, which a
 * press moves on to the next level. It shows what the server answers rather than what was asked. While
 * it saves it's dimmed and ignores presses, as the star does.
 */
export function InvolvementButton({ room, involvement, onSaved, onFailed, className }: Props) {
  const label = useId();
  const [saving, setSaving] = useState(false);
  const mounted = useMounted();
  const Bell = BELLS[involvement];

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      onSaved(room.id, await setInvolvement(room.id, nextInvolvement(room, involvement)));
    } catch (error) {
      if (mounted.current || isSignedOut(error)) onFailed(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked="true"
      aria-labelledby={label}
      aria-disabled={saving || undefined}
      onClick={save}
      className={cn("cursor-pointer aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:grayscale aria-disabled:contrast-50", className)}
    >
      <Bell width={20} height={20} className="size-[1.3em]" />
      <span id={label} className="sr-only">
        {INVOLVEMENT_LABELS[involvement]}
      </span>
    </button>
  );
}
