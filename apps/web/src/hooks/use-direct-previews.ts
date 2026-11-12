import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { DirectPreview, RoomId, SidebarRoom } from "@ember/protocol";
import { isSignedOut } from "@/lib/api";
import { fetchDirectPreviews } from "@/lib/conversations";
import { ROOM_MESSAGES_CHANGED } from "@/lib/room-changes";

/**
 * How long after a DM's activity changes its preview is asked for again, so that the search index, which
 * the Worker reads it from, has taken the message that changed it, and a burst of messages asks once.
 */
export const PREVIEW_DELAY_MS = 700;

/**
 * How often the previews are asked for again while the tab is shown, for the edits and deletions in DMs
 * not open here, which nothing tells this tab of as they're made.
 */
export const PREVIEW_REFRESH_MS = 30_000;

const NO_PREVIEWS: ReadonlyMap<RoomId, DirectPreview> = new Map();

// The previews last answered, which the DMs list starts from when it's shown again, rather than a moment
// without them until the next answer.
let kept = NO_PREVIEWS;

/** What changes `rooms`' DMs' previews: each one's activity, and its mark. */
const activityOf = (rooms: readonly SidebarRoom[]) =>
  rooms.flatMap((room) => (room.kind === "direct" ? [`${room.id}:${room.activeAt}:${room.unread ? (room.unreadSince ?? "") : "read"}`] : [])).join(" ");

/**
 * Each of `rooms`' DMs' latest message and how many are unread, by room, asked for once `enabled` and the
 * rooms have come, and again a moment after any DM is active or marked read or unread, or after the DM
 * open here has a message edited or deleted, and, for those in the others, as the tab is shown again and
 * every `PREVIEW_REFRESH_MS` while it's shown. Until the first answer comes the DMs show with the last ones
 * answered, if any, and if one fails, with what they had; `onSignedOut` hears of a session that has ended.
 */
export function useDirectPreviews(rooms: readonly SidebarRoom[] | null, enabled: boolean, onSignedOut: () => void): ReadonlyMap<RoomId, DirectPreview> {
  const [previews, setPreviews] = useState(kept);
  // Bumped whenever the previews may have changed with no activity to say so.
  const [changes, setChanges] = useState(0);
  const activity = useMemo(() => (rooms === null ? null : activityOf(rooms)), [rooms]);
  const signedOut = useEffectEvent(onSignedOut);
  const isDirect = useEffectEvent((roomId: unknown) => rooms?.some((room) => room.id === roomId && room.kind === "direct") ?? false);
  useEffect(() => {
    if (!enabled) return;
    const changed = () => setChanges((changes) => changes + 1);
    const edited = (event: Event) => isDirect((event as CustomEvent).detail) && changed();
    const shown = () => document.visibilityState === "visible" && changed();
    const refresh = setInterval(shown, PREVIEW_REFRESH_MS);
    window.addEventListener(ROOM_MESSAGES_CHANGED, edited);
    document.addEventListener("visibilitychange", shown);
    return () => {
      clearInterval(refresh);
      window.removeEventListener(ROOM_MESSAGES_CHANGED, edited);
      document.removeEventListener("visibilitychange", shown);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || activity === null) return;
    let stopped = false;
    const ask = setTimeout(() => {
      fetchDirectPreviews().then(
        ({ previews }) => {
          if (stopped) return;
          kept = new Map(previews.map((preview) => [preview.roomId, preview]));
          setPreviews(kept);
        },
        (error: unknown) => !stopped && isSignedOut(error) && signedOut(),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      stopped = true;
      clearTimeout(ask);
    };
  }, [enabled, activity, changes]);
  return previews;
}
