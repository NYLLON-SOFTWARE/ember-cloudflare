import { useEffect, useEffectEvent, useImperativeHandle, useRef, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import type { Favorites, Invitation, Involvement, Me } from "@ember/protocol";
import { MainContent } from "@/components/main-content";
import { useNameOf } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { composerEdit, useMessageEditors } from "@/hooks/use-message-editors";
import { EditingBar } from "../mobile/editing-bar";
import { useMessageSheets } from "../mobile/message-sheet";
import { useRoom } from "@/hooks/use-room";
import { useShowPresence } from "@/hooks/use-shown-presence";
import { useQuery, useVisit } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import { rememberLastRoom } from "@/lib/last-room";
import type { RoomAnswer } from "@/lib/room-list";
import { hasEditableText } from "@/lib/messages";
import { isPending } from "@/lib/room-state";
import { Composer, RoomGoneNotice, type ComposerHandle, type RoomGone } from "./composer";
import { MessageList } from "./message-list";
import { MobileRoomHeader } from "../mobile/room-header";
import { RoomHeader } from "./room-header";
import { RoomNotice } from "./room-notice";
import { RoomFramesContext } from "./room-tab-icons";
import { RoomTabs, RoomTabsContext, useRoomTabs } from "./room-tabs";
import { ThreadPanel } from "./thread-panel";

/** Where a thread covers its room, rather than showing beside it: below 1180px wide. */
const THREAD_COVERS_ROOM = "(width < 73.75rem)";

interface Props {
  room: Room;
  /** The message whose permalink the address is, which the timeline goes to. */
  messageId?: string;
  /** The message whose thread the address opens beside the room. */
  threadId?: string;
  /** The reply whose permalink the address is, which the thread goes to. */
  replyId?: string;
  /** The welcome card's invitation, when this is the room it's in. */
  invitation: Invitation | null;
  /** Dismisses the welcome card for good, settling once it's gone, or failed to go. */
  onDismissInvitation: () => Promise<void>;
  me: Me;
  /** Whether this person has starred the room. */
  favorite: boolean;
  /** Called with this person's stars once the room's star saves them. */
  onStarred: (favorites: Favorites) => void;
  /** This person's notification level in the room. */
  involvement: Involvement;
  /** When the room was marked unread as of when it was opened, which the timeline draws a New line at, or null. */
  newSince?: string | null;
  /** Called as its bell saves this person's level in the room, with what gives the room the level the server answers. */
  askForRoom: () => (answer: RoomAnswer) => void;
  onSessionChanged: (me: Me | null) => void;
  /** Says why the room's bell couldn't save a level, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
  /** When the room turns out to be gone for this person: deleted, or no longer theirs. */
  onGone: (room: Room, gone: RoomGone) => void;
  /** Shows the room in a pane, and its thread in another, as Activity does, rather than in the page's grid. */
  panes?: RoomPanes;
  ref?: Ref<RoomViewHandle>;
}

/** Where a room shown in a pane puts its open thread, once there's a pane for it, and what closes it. */
export interface RoomPanes {
  thread: HTMLElement | null;
  onCloseThread: () => void;
}

export interface RoomViewHandle {
  /** Gives the composer focus, as opening the room does, except on touch screens. */
  focusComposer(): void;
}

export function RoomView({ room, messageId, threadId, replyId, invitation, onDismissInvitation, me, favorite, onStarred, involvement, newSince = null, askForRoom, onSessionChanged, onFailed, onGone, panes, ref }: Props) {
  const { state, frames, postMessage, postFiles, typing, loadOlder, loadNewer, jump, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged, messageId);
  // What's beside the room, such as someone's profile, says who's in it.
  useShowPresence(state.present);
  const nameOf = useNameOf();
  const name = roomName(room, me.id, nameOf);
  const direct = room.kind === "direct";
  useTitle(name);
  // The room shown is remembered, for home and Go Back to return to.
  useEffect(() => rememberLastRoom(room.id), [room.id]);
  const foundGone: RoomGone | null = state.status !== "gone" ? null : state.lostAccess ? "lost access" : "deleted";
  const roomGone = useEffectEvent((found: RoomGone) => onGone(room, found));
  useEffect(() => {
    if (foundGone) roomGone(foundGone);
  }, [foundGone]);
  // The page shows why in the room's place once it hears, which is just after this.
  const whyGone = foundGone;
  const tabs = useRoomTabs(room, whyGone !== null, onFailed);

  // The room opens at the message its address names. Following its permalink, or one to another message
  // in it, or the room's own link, goes there, or to the newest, even when it's the page shown. One
  // followed while the room is away goes there once the room lets the page in again. Opening a thread,
  // even at a permalink, whose address the thread's takes the place of, going to one of its replies, or
  // closing it leaves the room's messages as they are. So does going from one of the room's tabs to another.
  const visit = useVisit();
  const tab = new URLSearchParams(useQuery()).get("tab");
  const visited = useRef({ messageId, visit, threadId, tab });
  const goTo = useEffectEvent((messageId: string | null) => jump(messageId));
  useEffect(() => {
    const last = visited.current;
    if (last.messageId === messageId && last.visit === visit) return;
    const inThread = threadId !== undefined || (last.threadId !== undefined && last.messageId === messageId);
    const toTab = last.tab !== tab && last.messageId === messageId;
    if (inThread || toTab || goTo(messageId ?? null)) visited.current = { messageId, visit, threadId, tab };
  }, [messageId, visit, threadId, tab, state.connections]);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);
  const composer = useRef<ComposerHandle>(null);
  // A phone edits a message in the composer, as Slack iOS does, rather than in the timeline.
  const { editing, editors, editedHere, doneHere } = useMessageEditors(composer, useMessageSheets());
  useImperativeHandle(ref, () => ({ focusComposer: editors.returnFocus }), [editors]);
  const edit = composerEdit(editedHere, state.messages, whyGone ? null : messageActions, doneHere);
  // A thread that covers the room leaves nothing of it to reach until it's closed.
  const covered = useMediaQuery(THREAD_COVERS_ROOM) && threadId !== undefined && !panes;
  // In panes, the thread goes in its own, once it's there.
  const placed = (thread: ReactNode) => (panes ? panes.thread && createPortal(thread, panes.thread) : thread);
  // A phone has a top bar of its own, Slack's.
  const Header = usePhoneLayout() ? MobileRoomHeader : RoomHeader;

  // Up Arrow edits your newest message, unless it's still on its way, or the timeline is reading older
  // history and may not hold it.
  const editLastMessage = () => {
    if (state.hasNewer) return;
    const newest = state.messages.findLast((message) => message.creator.id === me.id && hasEditableText(message));
    if (newest && !isPending(newest)) editors.open(newest.id);
  };

  return (
    <RoomTabsContext value={tabs}>
      <RoomFramesContext value={frames}>
        {/* The room's header and messages, placed in the page's grid as if they were its own. */}
        <div className={panes ? "grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)]" : "contents"} inert={covered}>
          <Header
            room={room}
            me={me}
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
          {edit && <EditingBar onCancel={edit.onCancel} />}
          {/* Backgrounds run under a landscape phone's notch; the room's contents stay clear of it. */}
          <MainContent className="relative flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
            <RoomTabs room={room} me={me} state={tabs} onFailed={onFailed} />
            <RoomNotice notice={state.notice} onDismiss={dismissNotice} />
            <MessageList
              roomName={name}
              direct={direct}
              parentName={room.kind === "direct" ? undefined : room.parent?.name}
              closed={room.kind === "closed"}
              invitation={invitation}
              onDismissInvitation={onDismissInvitation}
              state={state}
              me={me}
              actions={whyGone ? null : messageActions}
              editing={editing}
              editors={editors}
              onLoadOlder={loadOlder}
              onLoadNewer={loadNewer}
              onJumpToNewest={() => jump(null)}
              onDropFiles={(files) => composer.current?.addFiles(files)}
              openThread={threadId}
              newSince={newSince}
              editing={edit}
            />
            {whyGone ? (
              <RoomGoneNotice gone={whyGone} />
            ) : (
              <Composer
                ref={composer}
                roomId={room.id}
                roomName={name}
                direct={direct}
                closed={room.kind === "closed"}
                userId={me.id}
                typing={typingUsers}
                disabled={state.offline}
                // Only while the room's first messages are on their way, not once it's been out of reach a while.
                deferEditor={state.status === "connecting" && !state.offline}
                // The thread open beside the room takes focus as it opens.
                autoFocus={threadId === undefined}
                frames={frames}
                onSend={postMessage}
                onSendFiles={postFiles}
                onTyping={typing}
                onEditLastMessage={editLastMessage}
              />
            )}
          </MainContent>
        </div>
        {threadId !== undefined &&
          placed(
            <ThreadPanel
              key={threadId}
              room={room}
              name={name}
              me={me}
              parentId={threadId}
              replyId={replyId}
              frames={frames}
              status={state.status}
              offline={state.offline}
              gone={whyGone}
              roomNotice={covered ? state.notice : null}
              onDismissRoomNotice={dismissNotice}
              placement={panes ? "pane" : "column"}
              onClose={panes?.onCloseThread}
            />,
          )}
      </RoomFramesContext>
    </RoomTabsContext>
  );
}
