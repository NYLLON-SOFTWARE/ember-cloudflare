import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Favorites, Invitation, Me } from "@ember/protocol";
import { Close } from "@/components/icons/ember";
import { MainContent } from "@/components/main-content";
import { useNameOf } from "@/hooks/use-directory";
import { useRoom } from "@/hooks/use-room";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { hasTouchKeyboard } from "@/lib/keyboard";
import { rememberLastRoom } from "@/lib/last-room";
import { isPending } from "@/lib/room-state";
import { Composer, RoomDeleted, type ComposerHandle } from "./composer";
import type { MessageEditorHandle } from "./message-editor";
import type { MessageEditors } from "./message-item";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";

interface Props {
  room: Room;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  me: Me;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Whether the workspace socket has said the room is gone for this person, as it can before the room's own socket does. */
  gone: boolean;
  /** Called with this person's stars once the room's star saves them. */
  onStarred: (favorites: Favorites) => void;
  onSessionChanged: (me: Me | null) => void;
  /** When the room turns out to be gone for this person: deleted, or no longer theirs. */
  onGone: (room: Room) => void;
}

export function RoomView({ room, invitation, me, favorite, gone, onStarred, onSessionChanged, onGone }: Props) {
  const { state, postMessage, typing, loadOlder, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged);
  const nameOf = useNameOf();
  const name = roomName(room, me.id, nameOf);
  const direct = room.kind === "direct";
  useTitle(name);
  // As ember-rust's rooms#show remembers the room it shows, for home and Go Back to return to.
  useEffect(() => rememberLastRoom(room.id), [room.id]);
  const foundGone = state.status === "gone";
  const roomGone = useEffectEvent(() => onGone(room));
  useEffect(() => {
    if (foundGone) roomGone();
  }, [foundGone]);
  const deleted = gone || foundGone;
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);
  const composer = useRef<ComposerHandle>(null);
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());

  const editors = useMemo<MessageEditors>(() => {
    const open = new Map<string, MessageEditorHandle>();
    // As an editor closes, focus goes back to the composer, where ember-rust's is lost, except on touch
    // screens, where it would bring up the keyboard.
    const returnFocus = () => {
      if (!hasTouchKeyboard()) composer.current?.focus();
    };
    return {
      // Up Arrow returns to your newest message's editor if it's open, where ember-rust's finds no Edit
      // button there to press, and does nothing.
      open: (messageId) => {
        const editor = open.get(messageId);
        if (editor) editor.focus();
        else setEditing((ids) => (ids.has(messageId) ? ids : new Set(ids).add(messageId)));
      },
      close: (messageId) => {
        setEditing((ids) => new Set([...ids].filter((id) => id !== messageId)));
        returnFocus();
      },
      returnFocus,
      attach: (messageId, editor) => {
        if (editor) open.set(messageId, editor);
        else open.delete(messageId);
      },
      reply: (quote) => composer.current?.replace(quote),
    };
  }, []);

  // ember-rust's Up Arrow edits your newest message, unless it's still on its way.
  const editLastMessage = () => {
    const newest = state.messages.findLast((message) => message.creator.id === me.id);
    if (newest && !isPending(newest)) editors.open(newest.id);
  };

  return (
    <>
      <RoomHeader
        room={room}
        name={name}
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
        <MessageList
          roomName={name}
          direct={direct}
          invitation={invitation}
          state={state}
          me={me}
          actions={deleted ? null : messageActions}
          editing={editing}
          editors={editors}
          onLoadOlder={loadOlder}
        />
        {deleted ? (
          <RoomDeleted />
        ) : (
          <Composer
            ref={composer}
            roomId={room.id}
            roomName={name}
            direct={direct}
            userId={me.id}
            typing={typingUsers}
            disabled={state.offline}
            // Only while the room's first messages are on their way, not once it's been out of reach a while.
            deferEditor={state.status === "connecting" && !state.offline}
            onSend={postMessage}
            onTyping={typing}
            onEditLastMessage={editLastMessage}
          />
        )}
      </MainContent>
    </>
  );
}
