import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { Favorites, Invitation, Involvement, Me } from "@ember/protocol";
import { Xmark } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { useNameOf } from "@/hooks/use-directory";
import { useRoom } from "@/hooks/use-room";
import { useVisit } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { hasTouchKeyboard } from "@/lib/keyboard";
import { rememberLastRoom } from "@/lib/last-room";
import type { RoomAnswer } from "@/lib/room-list";
import { isPending } from "@/lib/room-state";
import { Composer, RoomDeleted, type ComposerHandle } from "./composer";
import type { MessageEditorHandle } from "./message-editor";
import type { MessageEditors } from "./message-item";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";

interface Props {
  room: Room;
  /** The message whose permalink the address is, which the timeline goes to. */
  messageId?: string;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  /** Dismisses the welcome card for good, settling once it's gone, or failed to go. */
  onDismissInvitation: () => Promise<void>;
  me: Me;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Whether the workspace socket has said the room is gone for this person, as it can before the room's own socket does. */
  gone: boolean;
  /** Called with this person's stars once the room's star saves them. */
  onStarred: (favorites: Favorites) => void;
  /** This person's notification level in the room. */
  involvement: Involvement;
  /** Called as its bell saves this person's level in the room, with what gives the room the level the server answers. */
  askForRoom: () => (answer: RoomAnswer) => void;
  onSessionChanged: (me: Me | null) => void;
  /** Says why the room's bell couldn't save a level, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  /** When the room turns out to be gone for this person: deleted, or no longer theirs. */
  onGone: (room: Room) => void;
  ref?: Ref<RoomViewHandle>;
}

export interface RoomViewHandle {
  /** Gives the composer focus, as opening the room does, except on touch screens. */
  focusComposer(): void;
}

export function RoomView({ room, messageId, invitation, onDismissInvitation, me, favorite, gone, onStarred, involvement, askForRoom, onSessionChanged, onFailed, onGone, ref }: Props) {
  const { state, postMessage, postFiles, typing, loadOlder, loadNewer, jump, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged, messageId);
  const nameOf = useNameOf();
  const name = roomName(room, me.id, nameOf);
  const direct = room.kind === "direct";
  useTitle(name);
  // The room shown is remembered, for home and Go Back to return to.
  useEffect(() => rememberLastRoom(room.id), [room.id]);
  const foundGone = state.status === "gone";
  const roomGone = useEffectEvent(() => onGone(room));
  useEffect(() => {
    if (foundGone) roomGone();
  }, [foundGone]);
  const deleted = gone || foundGone;

  // The room opens at the message its address names. Following its permalink, or one to another message
  // in it, or the room's own link, goes there, or to the newest, even when it's the page shown. One
  // followed while the room is away goes there once the room lets the page in again.
  const visit = useVisit();
  const visited = useRef({ messageId, visit });
  const goTo = useEffectEvent((messageId: string | null) => jump(messageId));
  useEffect(() => {
    if (visited.current.messageId === messageId && visited.current.visit === visit) return;
    if (goTo(messageId ?? null)) visited.current = { messageId, visit };
  }, [messageId, visit, state.connections]);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);
  const composer = useRef<ComposerHandle>(null);
  const [editing, setEditing] = useState<ReadonlySet<string>>(() => new Set());

  const editors = useMemo<MessageEditors>(() => {
    const open = new Map<string, MessageEditorHandle>();
    // As an editor closes, focus goes back to the composer, except on touch screens, where it would
    // bring up the keyboard.
    const returnFocus = () => {
      if (!hasTouchKeyboard()) composer.current?.focus();
    };
    return {
      // Up Arrow returns to your newest message's editor if it's open.
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
  useImperativeHandle(ref, () => ({ focusComposer: editors.returnFocus }), [editors]);

  // Up Arrow edits your newest message, unless it's still on its way, or the timeline is reading older
  // history and may not hold it.
  const editLastMessage = () => {
    if (state.hasNewer) return;
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
        involvement={involvement}
        askForRoom={askForRoom}
        onSessionChanged={onSessionChanged}
        onFailed={onFailed}
      />
      {/* Backgrounds run under a landscape phone's notch; the room's contents stay clear of it. */}
      <MainContent className="relative flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        {state.notice && (
          <div role="alert" className="mx-auto mt-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-[10px] bg-foreground py-2 pr-1 pl-3 text-sm text-background touch:py-0.5">
            {state.notice}
            <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="flex size-6 shrink-0 items-center justify-center rounded hover:opacity-80 touch:size-11">
              <Xmark className="size-4" />
            </button>
          </div>
        )}
        <MessageList
          roomName={name}
          direct={direct}
          invitation={invitation}
          onDismissInvitation={onDismissInvitation}
          state={state}
          me={me}
          actions={deleted ? null : messageActions}
          editing={editing}
          editors={editors}
          onLoadOlder={loadOlder}
          onLoadNewer={loadNewer}
          onJumpToNewest={() => jump(null)}
          onDropFiles={(files) => composer.current?.addFiles(files)}
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
            onSendFiles={postFiles}
            onTyping={typing}
            onEditLastMessage={editLastMessage}
          />
        )}
      </MainContent>
    </>
  );
}
