import { useLayoutEffect, useRef, useState } from "react";
import type { Favorites, Me, RoomId } from "@ember/protocol";
import { Star } from "@/components/icons/lucide";
import { useMounted } from "@/hooks/use-mounted";
import { isSignedOut, setFavorite } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  roomId: RoomId;
  /** Whether the room is starred, as the sidebar's list says. */
  favorite: boolean;
  /** Called with this person's stars as the server answers them, once a star or unstar is saved. */
  onSaved: (favorites: Favorites) => void;
  /** Called with null when the session has expired. */
  onSessionChanged: (me: Me | null) => void;
}

/**
 * The star in a room's header, which stars the room for you or unstars it, as ember-rust's does
 * (rooms/show/_nav.html, `.mb-favorite-button` in zz-ember.css and room_favorite_controller.js). It
 * shows what the server answers rather than what was asked, and when a save fails it says so in a note
 * under it, until it's pressed again. While it saves it's dimmed and ignores presses, as Campfire's
 * disabled buttons are (buttons.css), but with `aria-disabled`, so it keeps the keyboard's focus where
 * `disabled` would drop it.
 */
export function FavoriteButton({ roomId, favorite, onSaved, onSessionChanged }: Props) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useMounted();
  const note = useRef<HTMLSpanElement>(null);

  // ember-rust's note hangs from the star's left edge, so once a long name has pushed the star to the
  // end of the top bar, the note runs off the screen, or under a phone's rounded corner. This keeps it
  // inside the bar's padding, which clears them.
  useLayoutEffect(() => {
    const bar = note.current?.closest("nav");
    if (!note.current || !bar) return;
    const end = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight);
    const overflow = note.current.getBoundingClientRect().right - end;
    if (overflow > 0) note.current.style.left = `${-overflow}px`;
  }, [failed]);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      onSaved(await setFavorite(roomId, !favorite));
    } catch (error) {
      // Once another person's workspace has taken this one's place, the session it hears about is gone.
      if (!mounted.current) return;
      if (isSignedOut(error)) return onSessionChanged(null);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-label="Favorite room"
        aria-pressed={favorite}
        aria-disabled={saving || undefined}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={save}
        className={cn(
          // 44px for fingers, where ember-rust's is 32px wide and 36px tall everywhere.
          "flex min-h-9 w-8 items-center justify-center rounded-lg p-1.5 text-muted-foreground hover:bg-hover touch:size-11",
          "aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:grayscale aria-disabled:contrast-50",
        )}
      >
        <Star className={cn("size-[18px]", favorite && "fill-current")} />
      </button>
      {failed && (
        <span ref={note} role="status" className="absolute top-full left-0 z-30 w-[200px] rounded-[8px] border bg-background p-2.5 text-[13px] shadow-[0_4px_12px_var(--color-dialog-shadow-faint)]">
          Couldn’t save your favorite. Please try again.
        </span>
      )}
    </span>
  );
}
