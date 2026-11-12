import type { Me } from "@ember/protocol";
import { Lock } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { useNameOf } from "@/hooks/use-directory";
import { navigate, roomPath } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import type { Room } from "@/lib/api";
import { roomName } from "@/lib/directs";
import type { RoomGone } from "./composer";
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
    ? "You don't have access to this room"
    : gone === "lost access"
      ? `You no longer have access to ${named(room)}`
      : room.kind === "direct"
        ? "This DM was deleted"
        : `${named(room)} was deleted`;
  useTitle(room && roomName(room, me.id, nameOf));
  return (
    <>
      <PageHeader />
      <MainContent className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
        <div className="grid flex-1 place-content-center justify-items-center gap-4 p-6 text-center">
          <div role="alert" className="grid justify-items-center gap-3">
            {gone === "lost access" && <Lock aria-hidden className="size-8 text-muted-foreground" />}
            <h1 className="text-lg font-semibold wrap-anywhere">{title}</h1>
          </div>
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
