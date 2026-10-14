import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useState } from "react";
import type { Room, RoomId, User } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { Close } from "@/components/icons/ember";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useMounted } from "@/hooks/use-mounted";
import { ApiError, fetchRooms, isSignedOut } from "@/lib/api";
import { lastRoomVisited } from "@/lib/last-room";
import { byName, NO_ROOM_LIST, roomListReducer } from "@/lib/room-list";
import { navigate, roomPath, useRoute, type Route } from "@/hooks/use-route";
import { NewRoomPage } from "./new-room-page";
import { PageHeader } from "./page-header";
import { Rail, type RailPage } from "./rail";
import { RoomSettingsPage } from "./room-settings-page";
import { RoomView } from "./room-view";
import { Sidebar } from "./sidebar";
import { WelcomePage } from "./welcome-page";
import { WorkspaceSettingsPage } from "./workspace-settings-page";

/**
 * The rail's link for each page, as ember-rust's shell.js marks them: Home for a room and the pages
 * that go on to one, and none for a room's forms.
 */
const RAIL_PAGES = {
  home: "home",
  "newest-room": "home",
  room: "home",
  "room-of-kind": "home",
  "new-room": null,
  "room-settings": null,
  "workspace-settings": "workspace",
} as const satisfies Record<Route["page"], RailPage>;

/** An address the app goes on from, to `path`, with an alert to show there. */
interface Redirect {
  path: string;
  alert?: string;
}

/** As ember-rust sends someone home from a room they can't see (controllers/rooms.rs, `set_room`). */
const ROOM_NOT_FOUND: Redirect = { path: "/", alert: "Room not found or inaccessible" };

/** What an alert says about a request that failed: the server's reason, or that Ember couldn't be reached. */
const reasonFor = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Ember. Check your connection and try again.");

/** The room an address names that has to be one of someone's rooms, which a direct message's doesn't. */
function namedRoomId(route: Route): RoomId | null {
  if (route.page === "room-of-kind") return route.kind !== "direct" ? route.roomId : null;
  return route.page === "room" || route.page === "room-settings" ? route.roomId : null;
}

/**
 * Where an address goes on to once someone's rooms are known, as ember-rust redirects it, or null when
 * it shows a page of its own: home to the last room visited (controllers/welcome.rs), `/rooms` to the
 * newest room (rooms.rs, `index`), and a room's address for its kind to the room's own (rooms/opens.rs,
 * closeds.rs and directs.rs).
 */
function redirectOf(route: Route, rooms: Room[]): Redirect | null {
  switch (route.page) {
    case "home": {
      const room = lastRoomVisited(rooms);
      return room && { path: roomPath(room.id) };
    }
    case "newest-room":
      // ember-rust fails with no room to go to (`room_url(nil)`), where home says there are none.
      return { path: rooms.length > 0 ? roomPath(rooms.at(-1)!.id) : "/" };
    case "room-of-kind": {
      // A direct message's goes on without looking, and the room's own address checks it.
      if (route.kind === "direct") return { path: roomPath(route.roomId) };
      const room = rooms.find((r) => r.id === route.roomId);
      return room && room.kind !== "direct" ? { path: roomPath(room.id) } : ROOM_NOT_FOUND;
    }
    case "room":
      return rooms.some((r) => r.id === route.roomId) ? null : ROOM_NOT_FOUND;
    default:
      return null;
  }
}

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
  const [{ list, pending }, changeRooms] = useReducer(roomListReducer, NO_ROOM_LIST);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
  // The sidebar lists them by name.
  const listed = useMemo(() => byName(rooms ?? []), [rooms]);

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

  const flash = useFlash();
  const mounted = useMounted();
  // A session that's ended goes to sign in; anything else is an alert. Once another person's workspace
  // has taken this one's place, as another tab signing in makes it, what this one's pages hear is
  // about a session already replaced.
  const failed = useCallback(
    (error: unknown) => {
      if (!mounted.current) return;
      if (isSignedOut(error)) return onSessionChanged(null);
      flash("alert", reasonFor(error));
    },
    [flash, onSessionChanged, mounted],
  );
  const redirect = useCallback(
    ({ path, alert }: Redirect) => {
      navigate(path, { replace: true });
      if (alert) flash("alert", alert);
    },
    [flash],
  );
  const missing = useCallback(() => redirect(ROOM_NOT_FOUND), [redirect]);
  // A room just saved takes its place in the list, and one that's gone leaves it.
  const listRoom = useCallback((room: Room) => changeRooms({ type: "saved", room }), []);
  const unlistRoom = useCallback((roomId: RoomId) => changeRooms({ type: "gone", roomId }), []);

  // A room found gone while it's shown stays on screen to say so until another page shows.
  const [gone, setGone] = useState<{ room: Room; route: Route } | null>(null);
  const roomGone = (room: Room) => {
    setGone({ room, route });
    unlistRoom(room.id);
  };
  const goneRoom = gone?.route === route ? gone.room : null;

  // A room the list doesn't have may be one made, or opened to this person, since it came, which
  // ember-rust's server would know: the list is asked for again, once each time an address naming it is
  // visited, before a room's address counts as naming a room they can't see, and so its settings, once
  // saved, leave it where it was made rather than last, as a room just made goes. One list is on its way
  // at a time, so an older one can't take the place of a newer one, which has changes made here since.
  const [askedAgain, setAskedAgain] = useState<Route | null>(null);
  // A room's address the list couldn't be asked for again for, which stays rather than going home as if
  // the room weren't theirs, and says why in the page, until it's left or Try again asks again.
  const [unanswered, setUnanswered] = useState<{ route: Route; reason: string } | null>(null);
  const namedId = namedRoomId(route);
  const unlisted = rooms !== null && !goneRoom && namedId !== null && !rooms.some((r) => r.id === namedId);
  const askAgain = unlisted && askedAgain !== route && pending === null;
  useEffect(() => {
    if (!askAgain) return;
    setAskedAgain(route);
    changeRooms({ type: "asked" });
    fetchRooms().then(
      (list) => changeRooms({ type: "loaded", list }),
      (error) => {
        // As with `failed`, a session already replaced hears nothing.
        if (!mounted.current) return;
        if (isSignedOut(error)) return onSessionChanged(null);
        changeRooms({ type: "unanswered" });
        // A room's settings ask the server about the room themselves.
        if (route.page !== "room-settings") setUnanswered({ route, reason: reasonFor(error) });
      },
    );
  }, [askAgain, route, onSessionChanged, mounted]);
  const tryAgain = () => {
    setUnanswered(null);
    setAskedAgain(null);
  };
  const unansweredHere = unanswered?.route === route ? unanswered : null;

  // Where the address goes on to, once the list it goes by has come.
  const goingOn = useMemo(
    () => (rooms && pending === null && !askAgain && !goneRoom && !unansweredHere ? redirectOf(route, rooms) : null),
    [rooms, pending, askAgain, goneRoom, unansweredHere, route],
  );
  // Before the page paints, so a page that only goes on to another doesn't show.
  useLayoutEffect(() => {
    if (goingOn) redirect(goingOn);
  }, [goingOn, redirect]);

  const room = route.page !== "room" || goingOn ? null : (goneRoom ?? rooms?.find((r) => r.id === route.roomId) ?? null);
  // Go Back on the settings pages returns to the last room visited, as ember-rust's
  // `link_back_to_last_room_visited` does, or home when there's none.
  const lastRoom = rooms && lastRoomVisited(rooms);
  const back = lastRoom ? roomPath(lastRoom.id) : "/";
  // Another room closes the drawer once it shows, which a form with unsaved changes may hold off; the
  // room shown closes it at once.
  const select = (roomId: string) => {
    if (location.pathname === roomPath(roomId)) setDrawerOpen(false);
    else navigate(roomPath(roomId));
  };

  const navigation = (
    <>
      <Rail me={me} current={RAIL_PAGES[route.page]} onSignOut={onSignOut} />
      <Sidebar rooms={listed} currentRoomId={room?.id ?? null} onSelect={select} />
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
            back={back}
            onLeft={unlistRoom}
            onMissing={missing}
            onFailed={failed}
          />
        );
      case "workspace-settings":
        return <WorkspaceSettingsPage back={back} />;
      default:
        if (room)
          return (
            <RoomView
              key={room.id}
              room={room}
              invitation={invitation?.roomId === room.id ? invitation : null}
              me={me}
              onSessionChanged={onSessionChanged}
              onGone={roomGone}
            />
          );
        if (route.page === "home" && rooms && pending === null && !goingOn) return <WelcomePage me={me} />;
        // Why the room can't show, kept where it would show rather than in an alert that fades, as a
        // browser's own page says when ember-rust's server can't be reached. The header keeps the way to
        // the other rooms on a phone.
        if (unansweredHere)
          return (
            <>
              <PageHeader />
              <main className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
                <div className="grid flex-1 place-content-center justify-items-center gap-4 p-6 text-center">
                  <p role="alert" className="text-muted-foreground">
                    {unansweredHere.reason}
                  </p>
                  <Button type="button" variant="outline" className="touch:h-11" onClick={tryAgain}>
                    Try again
                  </Button>
                </div>
              </main>
            </>
          );
        // While the rooms load, or before the page goes on to another, which it does before this paints.
        return (
          <main className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">Loading…</main>
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
            <Sidebar rooms={listed} currentRoomId={room?.id ?? null} onSelect={select} />
            {/* ember-rust's .mb-sidebar-close: a 44px button clear of the status bar. */}
            <SheetClose className="absolute top-[max(7px,env(safe-area-inset-top))] right-1 flex size-11 items-center justify-center rounded-lg bg-surface hover:bg-hover">
              <Close className="size-5" />
              <span className="sr-only">Close conversations</span>
            </SheetClose>
          </div>
        </SheetContent>

        {page()}
      </div>
    </Sheet>
  );
}
