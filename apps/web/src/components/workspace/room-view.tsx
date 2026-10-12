import type { User } from "@ember/protocol";
import { Close } from "@/components/icons/ember";
import { useRoom } from "@/hooks/use-room";
import type { Room } from "@/lib/api";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { RoomHeader } from "./room-header";

interface Props {
  room: Room;
  token: string;
  me: User;
  onOpenMenu: () => void;
  onSessionExpired: () => void;
}

export function RoomView({ room, token, me, onOpenMenu, onSessionExpired }: Props) {
  const { state, postMessage, typing, loadOlder, messageActions, dismissNotice } = useRoom(room.id, token, me, onSessionExpired);
  const typingUsers = Object.values(state.typing)
    .map((t) => t.user)
    .filter((u) => u.id !== me.id);

  return (
    <>
      <RoomHeader name={room.name} present={state.present} status={state.status} onOpenMenu={onOpenMenu} />
      <main className="flex min-h-0 min-w-0 flex-col bg-background">
        {state.notice && (
          <div role="alert" className="mx-auto mt-3 flex items-center gap-2 rounded-[10px] bg-foreground px-3 py-2 text-sm text-background">
            {state.notice}
            <button type="button" aria-label="Dismiss" onClick={dismissNotice} className="rounded p-0.5 hover:opacity-80">
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
