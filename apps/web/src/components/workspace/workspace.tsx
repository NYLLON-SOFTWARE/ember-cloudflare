import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Account, DirectRoom, Favorites, Me, Room, RoomId, SidebarRoom, User } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { Close } from "@/components/icons/ember";
import { MainContent, SkipLink } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { PeopleContext, useDirectory } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { useSidebar } from "@/hooks/use-sidebar";
import { ApiError, isSignedOut, startDirect } from "@/lib/api";
import { lastRoomVisited } from "@/lib/last-room";
import { markedUnread } from "@/lib/room-list";
import { afterNavigating, navigate, pageMark, roomPath, useRoute, type Route } from "@/hooks/use-route";
import { CustomStylesPage } from "./custom-styles-page";
import { DirectSettingsPage } from "./direct-settings-page";
import { NewDirectDialog } from "./new-direct-dialog";
import { NewRoomPage } from "./new-room-page";
import { DrawerOpen, PageHeader } from "./page-header";
import { ProfilePage } from "./profile-page";
import { Rail, type RailPage } from "./rail";
import { RoomSettingsPage } from "./room-settings-page";
import { RoomView, type RoomViewHandle } from "./room-view";
import { Sidebar } from "./sidebar";
import { WelcomePage } from "./welcome-page";
import { WorkspaceSettingsPage } from "./workspace-settings-page";

/**
 * What the rail marks on each page, as ember-rust's shell.js does: the logo and Home at home, Home on
 * a room's page and the pages that go on to one, your avatar on your profile, and nothing on a room's
 * forms, a DM's settings or the Custom CSS page, whose addresses none of its links have, nor on New
 * direct message's, which goes on to the last room visited at once.
 */
const RAIL_PAGES = {
  home: "home",
  "newest-room": "room",
  room: "room",
  "room-of-kind": "room",
  "new-room": null,
  "room-settings": null,
  "new-direct": null,
  "direct-settings": null,
  "workspace-settings": "workspace",
  "custom-styles": null,
  profile: "profile",
} as const satisfies Record<Route["page"], RailPage>;

/** An address the app goes on from, to `path`, with an alert to show there. */
interface Redirect {
  path: string;
  alert?: string;
}

/** The rooms, and stars, of someone whose rooms haven't loaded yet. */
const NO_ROOMS: SidebarRoom[] = [];
const NO_FAVORITES: Favorites = { rooms: [], version: 0 };
const NO_PEOPLE: User[] = [];

/** As ember-rust sends someone home from a room they can't see (controllers/rooms.rs, `set_room`). */
const ROOM_NOT_FOUND: Redirect = { path: "/", alert: "Room not found or inaccessible" };

/** What an alert says about a request that failed: the server's reason, or that Ember couldn't be reached. */
const reasonFor = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Ember. Check your connection and try again.");

/**
 * The room an address names that has to be one of someone's rooms, which a direct message's address
 * doesn't, since the room's own address it goes on to checks.
 */
function namedRoomId(route: Route): RoomId | null {
  if (route.page === "room-of-kind") return route.kind !== "direct" ? route.roomId : null;
  return route.page === "room" || route.page === "room-settings" || route.page === "direct-settings" ? route.roomId : null;
}

/** The DM `roomId` names among `rooms`, or null when it isn't one of them. */
function directIn(rooms: Room[], roomId: RoomId): DirectRoom | null {
  const room = rooms.find((r) => r.id === roomId);
  return room?.kind === "direct" ? room : null;
}

/**
 * Where an address goes on to once someone's rooms are known, as ember-rust redirects it, or null when
 * it shows a page of its own: home to the last room visited (controllers/welcome.rs), `/rooms` to the
 * newest room (rooms.rs, `index`), a room's address for its kind to the room's own (rooms/opens.rs,
 * closeds.rs and directs.rs), and a DM's settings home, as `set_room` sends someone, unless it's theirs.
 * New direct message's goes home too, under the dialog it opens, where ember-rust's is a page.
 */
function redirectOf(route: Route, rooms: SidebarRoom[]): Redirect | null {
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
    case "direct-settings":
      return directIn(rooms, route.roomId) ? null : ROOM_NOT_FOUND;
    case "new-direct":
      return { path: "/" };
    default:
      return null;
  }
}

/**
 * ember-rust's drawer layout (`(max-width: 900px)` in shell.js): `max-md`, 900px wide and below, where
 * the rail and sidebar move into a drawer opened from the header.
 */
const DRAWER_LAYOUT = "(width < 56.3125rem)";

/** ember-rust's authenticated layout: rail | sidebar | header over main, or the drawer layout. */
interface Props {
  me: Me;
  /** The workspace's name, which titles the rail's logo and heads the sidebar. */
  workspaceName: string;
  /** This deployment's version, which workspace settings end with. */
  version: string;
  /**
   * Called with the workspace as the workspace socket last said it is, or as its settings last loaded or
   * saved it, when the socket has said nothing since they were asked for.
   */
  onAccountChanged: (account: Account) => void;
  /** Signs out, settling with whether it did. */
  onSignOut: () => Promise<boolean>;
  /**
   * Called when this browser's session stops signing in `me`: with null once it has expired, or with
   * whoever another tab signed in as.
   */
  onSessionChanged: (me: Me | null) => void;
}

export function Workspace({ me, workspaceName, version, onAccountChanged, onSignOut, onSessionChanged }: Props) {
  // How many times the workspace socket has said what the account is. A page's answer from the server
  // shows only if no more has been said since it was asked for, since it may have been read before.
  const accountsHeard = useRef(0);
  const accountHeard = useCallback(
    (account: Account) => {
      accountsHeard.current++;
      onAccountChanged(account);
    },
    [onAccountChanged],
  );
  const askForAccount = useCallback(() => {
    const heard = accountsHeard.current;
    return (account: Account) => {
      if (accountsHeard.current === heard) onAccountChanged(account);
    };
  }, [onAccountChanged]);
  // The people directory loads again whenever the sidebar does by itself, and follows whoever the
  // workspace socket says has changed.
  const directory = useDirectory();
  const { list, change: changeRooms, refresh, askForRoom } = useSidebar(me, onSessionChanged, directory, accountHeard, shownRoomGone);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // New direct message, while it's open, with the link that opened it, which gets focus back, or null
  // when its address did.
  const [newDirect, setNewDirect] = useState<{ opener: HTMLElement | null } | null>(null);
  // Activity's filter, which lives as long as the page, as ember-rust's shell.js keeps it: other pages
  // keep it on, and loading the page again starts with it off.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const closeDrawerButton = useRef<HTMLButtonElement>(null);
  const roomView = useRef<RoomViewHandle>(null);
  const route = useRoute();

  const rooms = list?.rooms ?? null;
  const invitation = list?.invitation ?? null;
  const favorites = list?.favorites ?? NO_FAVORITES;
  const starred = useMemo(() => new Set(favorites.rooms), [favorites]);

  // Crossing 900px, as a big phone does on its side, closes the drawer, as in ember-rust's shell.js.
  // The wider layout has no drawer, and one left open would be hidden but still dim the page.
  useEffect(() => {
    const drawerLayout = matchMedia(DRAWER_LAYOUT);
    const close = () => setDrawerOpen(false);
    drawerLayout.addEventListener("change", close);
    return () => drawerLayout.removeEventListener("change", close);
  }, []);

  // Another page starts with the drawer closed, as each of ember-rust's does.
  useEffect(() => setDrawerOpen(false), [route]);

  // On a phone, the drawer closes as New direct message opens, as direct_message_controller.js has it.
  const openNewDirect = (opener: HTMLElement | null) => {
    setDrawerOpen(false);
    setNewDirect({ opener });
  };
  useLayoutEffect(() => {
    if (route.page === "new-direct") openNewDirect(null);
  }, [route]);

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
  // And the welcome card shows the join link as workspace settings last loaded or regenerated it.
  const joinCodeChanged = useCallback((joinCode: string) => changeRooms({ type: "join code", joinCode }), []);
  const starredRooms = useCallback((favorites: Favorites) => changeRooms({ type: "starred", favorites }), []);

  // A room found gone while it's shown stays on screen to say so until another page shows, whether its
  // own socket finds it gone or the workspace socket, which can hear first, says so. A DM's settings
  // stay too, which go home once their own deletion answers, as the workspace socket can tell of it first.
  const [gone, setGone] = useState<{ room: Room; route: Route } | null>(null);
  const roomGone = (room: Room) => {
    setGone({ room, route });
    unlistRoom(room.id);
  };
  const goneRoom = gone?.route === route ? gone.room : null;
  // A room shown as gone that's listed again, as when someone is put back in it, shows as it is on a page
  // started afresh, since its own socket may have stopped. `returns` counts the rooms that came back so.
  const [returns, setReturns] = useState(0);
  const listedAgain = goneRoom !== null && rooms !== null && rooms.some((r) => r.id === goneRoom.id);
  useLayoutEffect(() => {
    if (!listedAgain) return;
    setGone(null);
    setReturns((returns) => returns + 1);
  }, [listedAgain]);

  // A room the list doesn't have may be one made, or opened to this person, since it came, which
  // ember-rust's server would know: the list is asked for again, once each time an address naming it is
  // visited, before a room's address counts as naming a room they can't see, and so its settings, once
  // saved, leave it where it was made rather than last, as a room just made goes. The sidebar has one
  // list on its way at a time, so an older one can't take the place of a newer one, which has changes
  // made here since, and this waits for one asked for after the address was visited.
  const [askedAgain, setAskedAgain] = useState<{ route: Route; answered: boolean } | null>(null);
  // A room's address the list couldn't be asked for again for, which stays rather than going home as if
  // the room weren't theirs, and says why in the page, until it's left or Try again asks again.
  const [unanswered, setUnanswered] = useState<{ route: Route; reason: string } | null>(null);
  const namedId = namedRoomId(route);
  const unlisted = rooms !== null && !goneRoom && namedId !== null && !rooms.some((r) => r.id === namedId);
  const askAgain = unlisted && askedAgain?.route !== route;
  const askingAgain = askAgain || (askedAgain?.route === route && !askedAgain.answered);
  useEffect(() => {
    if (!askAgain) return;
    setAskedAgain({ route, answered: false });
    const answered = () => setAskedAgain((asked) => (asked?.route === route ? { route, answered: true } : asked));
    refresh().then(answered, (error) => {
      // As with `failed`, a session already replaced hears nothing.
      if (!mounted.current) return;
      if (isSignedOut(error)) return onSessionChanged(null);
      answered();
      // A room's settings ask the server about the room themselves.
      if (route.page !== "room-settings") setUnanswered({ route, reason: reasonFor(error) });
    });
  }, [askAgain, route, refresh, onSessionChanged, mounted]);
  const tryAgain = () => {
    setUnanswered(null);
    setAskedAgain(null);
  };
  const unansweredHere = unanswered?.route === route ? unanswered : null;

  // Where the address goes on to, once the list it goes by has come.
  const goingOn = useMemo(
    () => (rooms && !askingAgain && !goneRoom && !unansweredHere ? redirectOf(route, rooms) : null),
    [rooms, askingAgain, goneRoom, unansweredHere, route],
  );
  // Before the page paints, so a page that only goes on to another doesn't show.
  useLayoutEffect(() => {
    if (goingOn) redirect(goingOn);
  }, [goingOn, redirect]);

  const room = route.page !== "room" || goingOn ? null : (goneRoom ?? rooms?.find((r) => r.id === route.roomId) ?? null);
  const direct = route.page !== "direct-settings" || goingOn || !rooms ? null : directIn(goneRoom ? [goneRoom] : rooms, route.roomId);
  // The workspace socket's news that a room is gone takes it out of the list, and the room or the DM's
  // settings shown stay. Declared as a function, so that `useSidebar` above can take it.
  function shownRoomGone(roomId: RoomId) {
    const shown = room ?? direct;
    if (shown?.id === roomId) setGone({ room: shown, route });
  }
  // Go Back on the settings pages returns to the last room visited, as ember-rust's
  // `link_back_to_last_room_visited` does, or home when there's none.
  const lastRoom = rooms && lastRoomVisited(rooms);
  const back = lastRoom ? roomPath(lastRoom.id) : "/";
  const select = (roomId: string) => navigate(roomPath(roomId));
  // A suggestion starts the DM with its person, or opens the one they have, and goes there, as
  // ember-rust's posts its form, listing it as the server answers.
  const startDirectWith = async (person: User) => {
    const answered = askForRoom();
    const mark = pageMark();
    try {
      const room = await startDirect([person.id]);
      answered({ type: "saved", room });
      // A page the person has gone to meanwhile stays, as a visit stops ember-rust's form going on to the DM.
      if (!mounted.current || pageMark() !== mark) return false;
      navigate(roomPath(room.id));
      return true;
    } catch (error) {
      failed(error);
      return false;
    }
  };
  // Following a link in the drawer closes it, as ember-rust's shell.js does: one to another page once
  // that page shows, which unsaved changes hold off while they're asked about, and one to the page
  // shown at once. One the browser opens somewhere else, such as in a new tab, leaves this page as it
  // was, so the drawer stays open, where ember-rust's closes it anyway.
  const closeForLinkHere = (event: MouseEvent) => {
    // A link followed in place has kept the browser from following it.
    if (!event.defaultPrevented) return;
    const link = (event.target as Element).closest("a[href]");
    if (link instanceof HTMLAnchorElement && link.pathname === location.pathname) setDrawerOpen(false);
  };
  // Following a link in the rail or the sidebar turns Activity off, as shell.js does, once the app goes
  // there, so keeping unsaved changes, which holds it here, keeps Activity on, where shell.js turns it
  // off anyway. One the browser opens somewhere else leaves this page as it was, as it leaves the drawer.
  const showAllForLink = (event: MouseEvent) => {
    if (event.defaultPrevented && (event.target as Element).closest("a[href]")) afterNavigating(() => setUnreadOnly(false));
  };
  const currentRoomId = room?.id ?? null;
  const activity = {
    on: unreadOnly,
    unread: (rooms ?? NO_ROOMS).filter((r) => markedUnread(r, currentRoomId)).length,
    onToggle: () => setUnreadOnly((on) => !on),
  };
  const rail = <Rail me={me} workspaceName={workspaceName} current={RAIL_PAGES[route.page]} activity={activity} onNewDirect={openNewDirect} />;
  const sidebar = (
    <Sidebar
      workspaceName={workspaceName}
      meId={me.id}
      rooms={rooms ?? NO_ROOMS}
      loaded={rooms !== null}
      suggestions={list?.suggestions ?? NO_PEOPLE}
      favorites={favorites}
      currentRoomId={currentRoomId}
      unreadOnly={unreadOnly}
      onSelect={select}
      onNewDirect={openNewDirect}
      onStartDirect={startDirectWith}
      onStarred={starredRooms}
      onSessionChanged={onSessionChanged}
    />
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
            askForRoom={askForRoom}
            back={back}
            onMissing={missing}
            onFailed={failed}
          />
        );
      case "workspace-settings":
        return (
          <WorkspaceSettingsPage
            me={me}
            back={back}
            version={version}
            askForAccount={askForAccount}
            onJoinCodeChanged={joinCodeChanged}
            reloadPeople={directory.reload}
            onPersonChanged={directory.update}
            onFailed={failed}
          />
        );
      case "custom-styles":
        return <CustomStylesPage askForAccount={askForAccount} onFailed={failed} />;
      case "profile":
        return <ProfilePage me={me} onSignOut={onSignOut} onFailed={failed} />;
      default:
        if (direct)
          return <DirectSettingsPage key={direct.id} room={direct} me={me} back={back} askForRoom={askForRoom} onMissing={missing} onFailed={failed} />;
        if (room)
          return (
            <RoomView
              key={`${room.id}/${returns}`}
              ref={roomView}
              room={room}
              messageId={route.page === "room" ? route.messageId : undefined}
              invitation={invitation?.roomId === room.id ? invitation : null}
              me={me}
              favorite={starred.has(room.id)}
              gone={goneRoom !== null}
              onStarred={starredRooms}
              onSessionChanged={onSessionChanged}
              onGone={roomGone}
            />
          );
        if (route.page === "home" && rooms && !goingOn) return <WelcomePage me={me} />;
        // Why the room can't show, kept where it would show rather than in an alert that fades, as a
        // browser's own page says when ember-rust's server can't be reached. The header keeps the way to
        // the other rooms on a phone.
        if (unansweredHere)
          return (
            <>
              <PageHeader />
              <MainContent className="flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]">
                <div className="grid flex-1 place-content-center justify-items-center gap-4 p-6 text-center">
                  <p role="alert" className="text-muted-foreground">
                    {unansweredHere.reason}
                  </p>
                  <Button type="button" variant="outline" className="touch:h-11" onClick={tryAgain}>
                    Try again
                  </Button>
                </div>
              </MainContent>
            </>
          );
        // While the rooms load, or before the page goes on to another, which it does before this paints.
        return (
          <MainContent className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">Loading…</MainContent>
        );
    }
  };

  // The Sheet wraps the whole layout so the header's menu button can be its trigger, which gives
  // it aria-expanded and gets focus back to it when the drawer closes. The skip link comes first,
  // and the rail and conversations are ember-rust's landmarks in either layout.
  const layout = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <DrawerOpen value={drawerOpen}>
        <div className="grid h-dvh grid-cols-[calc(var(--spacing-rail)+env(safe-area-inset-left))_var(--spacing-sidebar)_minmax(0,1fr)] grid-rows-[var(--spacing-header)_minmax(0,1fr)] overflow-hidden bg-surface max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[calc(56px+env(safe-area-inset-top))_minmax(0,1fr)]">
          <SkipLink />
          <div className="contents max-md:hidden [&>*]:row-span-2" onClick={showAllForLink}>
            {rail}
            <aside aria-label="Conversations" className="min-h-0 overflow-hidden border-r">
              {sidebar}
            </aside>
          </div>

          <SheetContent
            side="left"
            showCloseButton={false}
            // As ember-rust's shell.js does, opening it focuses its close button.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              closeDrawerButton.current?.focus();
            }}
            onClick={(event) => {
              closeForLinkHere(event);
              showAllForLink(event);
            }}
            className="flex w-auto max-w-[calc(100dvw-16px)] flex-row gap-0 border-0 bg-surface p-0 shadow-none sm:max-w-[calc(100dvw-16px)] md:hidden"
          >
            <SheetTitle className="sr-only">Conversations</SheetTitle>
            <SheetDescription className="sr-only">Rooms and direct messages</SheetDescription>
            <div className="pt-[env(safe-area-inset-top)]">{rail}</div>
            {/* As in ember-rust, the drawer leaves at least 16px of the room showing. */}
            <aside aria-label="Conversations" className="relative w-sidebar min-w-0 overflow-hidden border-r pt-[env(safe-area-inset-top)]">
              {/* ember-rust's .mb-sidebar-close: a 44px button clear of the status bar, first in the sidebar's tab order. */}
              <SheetClose
                ref={closeDrawerButton}
                aria-label="Close conversations"
                className="absolute top-[max(7px,env(safe-area-inset-top))] right-1 z-[2] flex size-11 items-center justify-center rounded-lg bg-surface hover:bg-hover"
              >
                <Close className="size-5" />
              </SheetClose>
              {sidebar}
            </aside>
          </SheetContent>

          {page()}
          {newDirect && (
            <NewDirectDialog
              opener={newDirect.opener}
              meId={me.id}
              reloadPeople={directory.reload}
              askForRoom={askForRoom}
              onClose={(startedShown) => {
                setNewDirect(null);
                // The DM shown stays as it is when it's the one started, so its composer takes focus, as
                // opening it would.
                if (startedShown) roomView.current?.focusComposer();
              }}
              onFailed={failed}
            />
          )}
        </div>
      </DrawerOpen>
    </Sheet>
  );
  return <PeopleContext value={directory.people}>{layout}</PeopleContext>;
}
