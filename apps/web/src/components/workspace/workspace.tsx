import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ApiError, fetchRooms, type Room, type Session } from "@/lib/api";
import { navigate, useRoomRoute } from "@/hooks/use-route";
import { Rail } from "./rail";
import { RoomView } from "./room-view";
import { Sidebar } from "./sidebar";

/**
 * ember-rust's authenticated layout: rail | sidebar | header over main.
 * Below 900px the rail and sidebar move into a drawer opened from the header.
 */
export function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const routeRoomId = useRoomRoute();

  useEffect(() => {
    fetchRooms(session.token)
      .then(setRooms)
      .catch((error) => (error instanceof ApiError && error.status === 401 ? onSignOut() : setRooms([])));
  }, [session.token, onSignOut]);

  const room = rooms?.find((r) => r.id === routeRoomId) ?? rooms?.[0] ?? null;
  const select = (roomId: string) => {
    navigate(`/rooms/${roomId}`);
    setDrawerOpen(false);
  };

  const navigation = (
    <>
      <Rail me={session.user} onSignOut={onSignOut} />
      <Sidebar rooms={rooms ?? []} currentRoomId={room?.id ?? null} onSelect={select} />
    </>
  );

  return (
    <div className="grid h-dvh grid-cols-[var(--spacing-rail)_var(--spacing-sidebar)_minmax(0,1fr)] grid-rows-[var(--spacing-header)_minmax(0,1fr)] overflow-hidden bg-surface max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[calc(56px+env(safe-area-inset-top))_minmax(0,1fr)]">
      <div className="contents max-md:hidden [&>*]:row-span-2 [&>*:nth-child(2)]:border-r">{navigation}</div>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="flex w-[calc(var(--spacing-rail)+min(280px,100dvw-var(--spacing-rail)-16px))] max-w-none flex-row gap-0 border-0 bg-surface p-0 sm:max-w-none md:hidden">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Rooms and direct messages</SheetDescription>
          <div className="pt-[env(safe-area-inset-top)]">
            <Rail me={session.user} onSignOut={onSignOut} />
          </div>
          <div className="min-w-0 flex-1 pt-[env(safe-area-inset-top)]">
            <Sidebar rooms={rooms ?? []} currentRoomId={room?.id ?? null} onSelect={select} />
          </div>
        </SheetContent>
      </Sheet>

      {room ? (
        <RoomView
          key={room.id}
          room={room}
          token={session.token}
          me={session.user}
          onOpenMenu={() => setDrawerOpen(true)}
          onSessionExpired={onSignOut}
        />
      ) : (
        <main className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">
          {rooms ? "No rooms yet." : "Loading…"}
        </main>
      )}
    </div>
  );
}
