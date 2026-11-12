import type { Me } from "@ember/protocol";
import { Lock, Trash } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { useNameOf } from "@/hooks/use-directory";
import { navigate, roomPath } from "@/hooks/use-route";
import { useUnsentInGoneRoom } from "@/hooks/use-unsent";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import type { RoomGone } from "./composer";
import { CopyButton, ROUND_BUTTON } from "./link-buttons";
import { PageHeader } from "./page-header";

interface Props {
  /** The room that's gone, or null for an address naming a room this person can't see. */
  room: Room | null;
  gone: RoomGone;
  /** The room the button goes to: the last one visited that they can still see, if any. */
  goTo: Room | null;
  me: Me;
}

/**
 * What takes the place of a room that's gone for this person, header and all, saying why, with a way on to
 * a room they can see.
 */
export function RoomUnavailable({ room, gone, goTo, me }: Props) {
  const nameOf = useNameOf();
  const named = (room: Room) => (room.kind === "direct" ? roomName(room, me.id, nameOf) : `#${roomName(room, me.id, nameOf)}`);
  const title = !room
    ? "You don’t have access to this room"
    : gone === "lost access"
      ? `You no longer have access to ${named(room)}`
      : room.kind === "direct"
        ? "This DM was deleted"
        : `${named(room)} was deleted`;
  useTitle(room && roomName(room, me.id, nameOf));
  return (
    <>
      {/* The bar names the room, muted, where it knows which, as the room's own header would, and on a wide screen
          draws no rule under nothing. */}
      <PageHeader back="/" className={room ? undefined : "md:border-b-0"}>{room && <span className="min-w-0 truncate text-[17px] leading-[1.4] font-[650] text-muted-foreground max-md:text-base">{named(room)}</span>}</PageHeader>
      <MainContent className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        <div className="grid flex-1 place-content-center justify-items-center gap-4 p-6 text-center">
          <div role="alert" className="grid justify-items-center gap-3">
            {gone === "lost access" && <Lock aria-hidden className="size-8 text-muted-foreground" />}
            <h1 className="text-lg font-semibold text-balance wrap-anywhere">{title}</h1>
          </div>
          {room && <Unsent roomId={room.id} me={me} />}
          {goTo && (
            <Button type="button" className="touch:h-11" onClick={() => navigate(roomPath(goTo.id))}>
              Go to {named(goTo)}
            </Button>
          )}
        </div>
      </MainContent>
    </>
  );
}

/** What this person wrote in the room that it never had, each to copy or delete, or nothing where there's none. */
function Unsent({ roomId, me }: { roomId: string; me: Me }) {
  const { messages, forget } = useUnsentInGoneRoom(roomId, me);
  if (messages.length === 0) return null;
  return (
    <ul aria-label="Not sent" className="grid w-full max-w-md gap-2 text-start">
      {messages.map((message) => (
        <li key={message.clientMessageId} className="flex items-start gap-2 rounded-lg border bg-surface p-3">
          <p className="min-w-0 flex-1 self-center text-sm whitespace-pre-wrap wrap-anywhere">{message.plainText}</p>
          <CopyButton text={message.plainText} label="Copy" className={ROUND_BUTTON} />
          <button type="button" onClick={() => forget(message.clientMessageId)} className={ROUND_BUTTON}>
            <span className="sr-only">Delete</span>
            <Trash className="size-[1.3em]" />
          </button>
        </li>
      ))}
    </ul>
  );
}
