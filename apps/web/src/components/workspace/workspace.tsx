import { useCallback, useEffect, useReducer, useState } from "react";
import type { Room, RoomId, User } from "@ember/protocol";
import { Flash } from "@/components/flash";
import { Close } from "@/components/icons/ember";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, fetchRooms, isSignedOut } from "@/lib/api";
import { NO_ROOM_LIST, roomListReducer } from "@/lib/room-list";
import { navigate, roomPath, useRoute, type Route } from "@/hooks/use-route";
import { NewRoomPage } from "./new-room-page";
import { Rail, type RailPage } from "./rail";
import { RoomSettingsPage } from "./room-settings-page";
import { RoomView } from "./room-view";
import { Sidebar } from "./sidebar";
import { WorkspaceSettingsPage } from "./workspace-settings-page";

/** The rail's link for each page, as ember-rust's shell.js marks them: Home for a room, and none for a room's forms. */
const RAIL_PAGES = { room: "home", "new-room": null, "room-settings": null, "workspace-settings": "workspace" } as const satisfies Record<Route["page"], RailPage>;

/**
 * ember-rust's authenticated layout: rail | sidebar | header over main.
 * Below 900px the rail and sidebar move into a drawer opened from the header.
 */
interface Props {
  me: User;
  /** Signs out, settling with whether it did. */
  onSignOut: () => Promise<boolean>;
  /**
   * Called when this browser's session stops signing in `me`: with null once it has expired, or with
   * whoever another tab signed in as.
   */
  onSessionChanged: (me: User | null) => void;
}

export function Workspace({ me, onSignOut, onSessionChanged }: Props) {
  const [{ list }, changeRooms] = useReducer(roomListReducer, NO_ROOM_LIST);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Keyed, so the same alert twice fades in again.
  const [alert, setAlert] = useState<{ text: string; key: number } | null>(null);
  const route = useRoute();

  useEffect(() => {
    fetchRooms()
      .then((list) => changeRooms({ type: "loaded", list }))
      .catch((error) =>
        error instanceof ApiError && error.status === 401 ? onSessionChanged(null) : changeRooms({ type: "loaded", list: { rooms: [], invitation: null } }),
      );
  }, [onSessionChanged]);

  const rooms = list?.rooms ?? null;
  const invitation = list?.invitation ?? null;

  // Crossing 900px, as a big phone does on its side, closes the drawer, as in ember-rust's shell.js.
  // The wider layout has no drawer, and one left open would be hidden but still dim the page.
  useEffect(() => {
    const drawerLayout = matchMedia("(width < 56.25rem)");
    const close = () => setDrawerOpen(false);
    drawerLayout.addEventListener("change", close);
    return () => drawerLayout.removeEventListener("change", close);
  }, []);

  // Another page starts with the drawer closed, as each of ember-rust's does.
  useEffect(() => setDrawerOpen(false), [route]);

  const flash = useCallback((text: string) => setAlert((shown) => ({ text, key: (shown?.key ?? 0) + 1 })), []);
  const mounted = useMounted();
  // A session that's ended goes to sign in; anything else is an alert. Once another person's workspace
  // has taken this one's place, as another tab signing in makes it, what this one's pages hear is
  // about a session already replaced.
  const failed = useCallback(
    (error: unknown) => {
      if (!mounted.current) return;
      if (isSignedOut(error)) return onSessionChanged(null);
      flash(error instanceof ApiError ? error.message : "Couldn't reach Ember. Check your connection and try again.");
    },
    [flash, onSessionChanged, mounted],
  );
  // As ember-rust redirects home from a room someone can't see (controllers/rooms/mod.rs).
  const missing = useCallback(() => {
    navigate("/", { replace: true });
    flash("Room not found or inaccessible");
  }, [flash]);
  // A room just saved takes its place in the list, by name, and one that's gone leaves it.
  const listRoom = useCallback((room: Room) => changeRooms({ type: "saved", room }), []);
  const unlistRoom = useCallback((roomId: RoomId) => changeRooms({ type: "gone", roomId }), []);

  // A room found gone while it's shown stays on screen to say so until another page shows.
  const [gone, setGone] = useState<{ room: Room; route: Route } | null>(null);
  const roomGone = (room: Room) => {
    setGone({ room, route });
    unlistRoom(room.id);
  };

  const room = route.page !== "room" ? null : gone?.route === route ? gone.room : (rooms?.find((r) => r.id === route.roomId) ?? rooms?.[0] ?? null);
  // Another room closes the drawer once it shows, which a form with unsaved changes may hold off; the
  // room shown closes it at once.
  const select = (roomId: string) => {
    if (location.pathname === roomPath(roomId)) setDrawerOpen(false);
    else navigate(roomPath(roomId));
  };

  const navigation = (
    <>
      <Rail me={me} current={RAIL_PAGES[route.page]} onSignOut={onSignOut} />
      <Sidebar rooms={rooms ?? []} currentRoomId={room?.id ?? null} onSelect={select} />
    </>
  );

  const page = () => {
    switch (route.page) {
      case "new-room":
        // Not keyed, so flipping Everyone, which changes the address, keeps what's filled in.
        return <NewRoomPage access={route.access} me={me} onCreated={listRoom} onFailed={failed} />;
      case "room-settings":
        return (
          <RoomSettingsPage
            key={route.roomId}
            roomId={route.roomId}
            access={route.access}
            me={me}
            onSaved={listRoom}
            onLeft={unlistRoom}
            onMissing={missing}
            onFailed={failed}
          />
        );
      case "workspace-settings":
        return <WorkspaceSettingsPage />;
      case "room":
        return room ? (
          <RoomView
            key={room.id}
            room={room}
            invitation={invitation?.roomId === room.id ? invitation : null}
            me={me}
            onSessionChanged={onSessionChanged}
            onGone={roomGone}
          />
        ) : (
          <main className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">
            {rooms ? "No rooms yet." : "Loading…"}
          </main>
        );
    }
  };

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
            <Rail me={me} current={RAIL_PAGES[route.page]} onSignOut={onSignOut} />
          </div>
          {/* As in ember-rust, the drawer leaves at least 16px of the room showing. */}
          <div className="relative w-sidebar min-w-0 pt-[env(safe-area-inset-top)]">
            <Sidebar rooms={rooms ?? []} currentRoomId={room?.id ?? null} onSelect={select} />
            {/* ember-rust's .mb-sidebar-close: a 44px button clear of the status bar. */}
            <SheetClose className="absolute top-[max(7px,env(safe-area-inset-top))] right-1 flex size-11 items-center justify-center rounded-lg bg-surface hover:bg-hover">
              <Close className="size-5" />
              <span className="sr-only">Close conversations</span>
            </SheetClose>
          </div>
        </SheetContent>

        {page()}
      </div>
      {alert && (
        <Flash key={alert.key} workspace onDone={() => setAlert(null)}>
          {alert.text}
        </Flash>
      )}
    </Sheet>
  );
}
