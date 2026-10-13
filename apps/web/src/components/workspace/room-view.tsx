import type { User } from "@ember/protocol";
import { Close } from "@/components/icons/ember";
import { useRoom } from "@/hooks/use-room";
import type { Room } from "@/lib/api";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";

interface Props {
  room: Room;
  me: User;
  onSessionChanged: (me: User | null) => void;
}

export function RoomView({ room, me, onSessionChanged }: Props) {
  const { state, postMessage, typing, loadOlder, messageActions, dismissNotice } = useRoom(room.id, me, onSessionChanged);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);

  return (
    <>
      <RoomHeader name={room.name} present={state.present} status={state.status} />
      {/* Backgrounds run under a landscape phone's notch; the room's contents stay clear of it. */}
      <main className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        {state.notice && (
          <div role="alert" className="mx-auto mt-3 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-[10px] bg-foreground py-2 pr-1 pl-3 text-sm text-background touch:py-0.5">
            {state.notice}
            <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="flex size-6 shrink-0 items-center justify-center rounded hover:opacity-80 touch:size-11">
              <Close className="size-4" />
            </button>
          </div>
        )}
        <MessageList roomName={room.name} state={state} me={me} actions={messageActions} onLoadOlder={loadOlder} />
        <Composer roomName={room.name} typing={typingUsers} disabled={state.status !== "open"} onSend={postMessage} onTyping={typing} />
      </main>
    </>
  );
}
