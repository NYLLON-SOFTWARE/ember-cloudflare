import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { DirectPreview, RoomId, SidebarRoom } from "@ember/protocol";
import { isSignedOut } from "@/lib/api";
import { fetchDirectPreviews } from "@/lib/conversations";

/**
 * How long after a DM's activity changes its preview is asked for again, so that the search index, which
 * the Worker reads it from, has taken the message that changed it, and a burst of messages asks once.
 */
export const PREVIEW_DELAY_MS = 700;

const NO_PREVIEWS: ReadonlyMap<RoomId, DirectPreview> = new Map();

/** What changes `rooms`' DMs' previews: each one's activity, and its mark. */
const activityOf = (rooms: readonly SidebarRoom[]) =>
  rooms.flatMap((room) => (room.kind === "direct" ? [`${room.id}:${room.activeAt}:${room.unread ? (room.unreadSince ?? "") : "read"}`] : [])).join(" ");

/**
 * Each of `rooms`' DMs' latest message and how many are unread, by room, asked for once `enabled` and the
 * rooms have come, and again a moment after any DM is active or marked read or unread. Until the first
 * answer comes, and if one fails, the DMs show without them; `onSignedOut` hears of a session that has ended.
 */
export function useDirectPreviews(rooms: readonly SidebarRoom[] | null, enabled: boolean, onSignedOut: () => void): ReadonlyMap<RoomId, DirectPreview> {
  const [previews, setPreviews] = useState(NO_PREVIEWS);
  const activity = useMemo(() => (rooms === null ? null : activityOf(rooms)), [rooms]);
  const signedOut = useEffectEvent(onSignedOut);
  useEffect(() => {
    if (!enabled || activity === null) return;
    let stopped = false;
    const ask = setTimeout(() => {
      fetchDirectPreviews().then(
        ({ previews }) => !stopped && setPreviews(new Map(previews.map((preview) => [preview.roomId, preview]))),
        (error: unknown) => !stopped && isSignedOut(error) && signedOut(),
      );
    }, PREVIEW_DELAY_MS);
    return () => {
      stopped = true;
      clearTimeout(ask);
    };
  }, [enabled, activity]);
  return previews;
}
