import { useEffect, useEffectEvent } from "react";
import type { Favorites, Invitation, Me, User } from "@ember/protocol";
import { Close } from "@/components/icons/ember";
import { MainContent } from "@/components/main-content";
import { useRoom } from "@/hooks/use-room";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { rememberLastRoom } from "@/lib/last-room";
import { Composer, RoomDeleted } from "./composer";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";

interface Props {
  room: Room;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  me: User;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Called with this person's stars once the room's star saves them. */
  onStarred: (favorites: Favorites) => void;
  onSessionChanged: (me: Me | null) => void;
  /** When the room turns out to be gone for this person: deleted, or no longer theirs. */
  onGone: (room: Room) => void;
}

export function RoomView({ room, invitation, me, favorite, onStarred, onSessionChanged, onGone }: Props) {
  const { state, postMessage, typing, loadOlder, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged);
  useTitle(room.name);
  // As ember-rust's rooms#show remembers the room it shows, for home and Go Back to return to.
  useEffect(() => rememberLastRoom(room.id), [room.id]);
  const gone = state.status === "gone";
  const roomGone = useEffectEvent(() => onGone(room));
  useEffect(() => {
    if (gone) roomGone();
  }, [gone]);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);

  return (
    <>
      <RoomHeader
        room={room}
        present={state.present}
        status={state.status}
        offline={state.offline}
        favorite={favorite}
        onStarred={onStarred}
        onSessionChanged={onSessionChanged}
      />
      {/* Backgrounds run under a landscape phone's notch; the room's contents stay clear of it. */}
      <MainContent className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        {state.notice && (
          <div role="alert" className="mx-auto mt-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-[10px] bg-foreground py-2 pr-1 pl-3 text-sm text-background touch:py-0.5">
            {state.notice}
            <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="flex size-6 shrink-0 items-center justify-center rounded hover:opacity-80 touch:size-11">
              <Close className="size-4" />
            </button>
          </div>
        )}
        <MessageList roomName={room.name} invitation={invitation} state={state} me={me} actions={gone ? null : messageActions} onLoadOlder={loadOlder} />
        {gone ? <RoomDeleted /> : <Composer roomName={room.name} typing={typingUsers} disabled={state.offline} onSend={postMessage} onTyping={typing} />}
      </MainContent>
    </>
  );
}
