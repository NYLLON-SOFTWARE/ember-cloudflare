import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
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

  // Crossing 900px, as a big phone does on its side, closes the drawer, as in ember-rust's shell.js.
  // The wider layout has no drawer, and one left open would be hidden but still dim the page.
  useEffect(() => {
    const drawerLayout = matchMedia("(width < 56.25rem)");
    const close = () => setDrawerOpen(false);
    drawerLayout.addEventListener("change", close);
    return () => drawerLayout.removeEventListener("change", close);
  }, []);

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

  // The Sheet wraps the whole layout so the header's menu button can be its trigger, which gives
  // it aria-expanded and gets focus back to it when the drawer closes.
  return (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <div className="grid h-dvh grid-cols-[calc(var(--spacing-rail)+env(safe-area-inset-left))_var(--spacing-sidebar)_minmax(0,1fr)] grid-rows-[var(--spacing-header)_minmax(0,1fr)] overflow-hidden bg-surface max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[calc(56px+env(safe-area-inset-top))_minmax(0,1fr)]">
        <div className="contents max-md:hidden [&>*]:row-span-2 [&>*:nth-child(2)]:border-r">{navigation}</div>

        <SheetContent side="left" showCloseButton={false} className="flex w-auto max-w-[calc(100dvw-16px)] flex-row gap-0 border-0 bg-surface p-0 sm:max-w-[calc(100dvw-16px)] md:hidden">
          <SheetTitle className="sr-only">Conversations</SheetTitle>
          <SheetDescription className="sr-only">Rooms and direct messages</SheetDescription>
          <div className="pt-[env(safe-area-inset-top)]">
            <Rail me={session.user} onSignOut={onSignOut} />
          </div>
          {/* As in ember-rust, the drawer leaves at least 16px of the room showing. */}
          <div className="relative w-sidebar min-w-0 pt-[env(safe-area-inset-top)]">
            <Sidebar rooms={rooms ?? []} currentRoomId={room?.id ?? null} onSelect={select} />
            {/* ember-rust's .mb-sidebar-close: a 44px button clear of the status bar. */}
            <SheetClose className="absolute top-[max(7px,env(safe-area-inset-top))] right-1 flex size-11 items-center justify-center rounded-lg bg-surface hover:bg-hover">
              <X className="size-5" />
              <span className="sr-only">Close conversations</span>
            </SheetClose>
          </div>
        </SheetContent>

        {room ? (
          <RoomView key={room.id} room={room} token={session.token} me={session.user} onSessionExpired={onSignOut} />
        ) : (
          <main className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">
            {rooms ? "No rooms yet." : "Loading…"}
          </main>
        )}
      </div>
    </Sheet>
  );
}
