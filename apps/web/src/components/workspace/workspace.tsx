import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ASSISTANT_ID, searchOfQuery, startingInvolvement, type Account, type DirectRoom, type Favorites, type Me, type Room, type RoomId, type SidebarRoom, type User } from "@ember/protocol";
import { useFlash } from "@/components/flash";
import { Xmark } from "@/components/icons/iconoir";
import { MainContent, SkipLink } from "@/components/main-content";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useAccount } from "@/hooks/use-account";
import { useActivity } from "@/hooks/use-activity";
import { useAppBadge } from "@/hooks/use-app-badge";
import { DirectoryLoaded, PeopleContext, useDirectory } from "@/hooks/use-directory";
import { useDraftCount } from "@/hooks/use-draft-count";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useHuddle } from "@/hooks/use-huddle";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { useMounted } from "@/hooks/use-mounted";
import { useReleaseCheck } from "@/hooks/use-release-check";
import { useSidebar } from "@/hooks/use-sidebar";
import { ApiError, dismissInvitation, isSignedOut, startDirect } from "@/lib/api";
import { hearHuddleEnd, leaveHuddle, muteHuddle } from "@/lib/huddle-store";
import { whenIdle } from "@/lib/idle";
import { opensFind, opensShortcuts, togglesHuddle, togglesMute } from "@/lib/keyboard";
import { lastChannelVisited, lastRoomVisited, rememberLastChannel } from "@/lib/last-room";
import { takeMemberfulFlash } from "@/lib/memberful";
import { loadPage } from "@/lib/page";
import { updateOf } from "@/lib/release-check";
import { apart, markedUnread } from "@/lib/room-list";
import { cn } from "@/lib/utils";
import { dmPath, messagePath, navigate, pageMark, returnTo, roomPath, routeOf, useHash, usePath, useQuery, useRoute, type Route } from "@/hooks/use-route";
import { HomePage } from "../mobile/home-page";
import { NewReleaseContext } from "../mobile/you-sheet";
import { TabBar, type TabNotices } from "../mobile/tab-bar";
import { KeyboardInset } from "../mobile/keyboard-inset";
import { tabOf, type Tab } from "../mobile/tabs";
import { addressShowing } from "./room-tabs";
import type { RoomGone } from "./composer";
import { HuddlesContext, NO_HUDDLES, type Huddles } from "./huddle-button";
import { MovedNotice } from "./moved-notice";
import { opensProfile, PROFILE_PARAM, ProfilePaneContext, type ProfilePane } from "./profile-pane";
import { DrawerOpen, PageHeader } from "./page-header";
import { Rail, type RailPage } from "./rail";
import { OpenSearchContext, type SearchBoxOptions } from "./search-box";
import { RoomUnavailable } from "./room-unavailable";
import { SettingsLayout, settingsSectionOf, type SettingsPlace } from "./settings-navigation";
import { Sidebar, type SidebarPage } from "./sidebar";
import { WelcomePage } from "./welcome-page";
import { ConversationsContext } from "./quote-cite";
import { loadRarePages, RarePage, type RarePages } from "./rare-pages";

/** What an address shows when it's one of the pages few visits need. */
const RARE_PAGES = new Set<Route["page"]>([
  "new-room",
  "room-settings",
  "direct-settings",
  "workspace-settings",
  "custom-styles",
  "bots",
  "new-bot",
  "bot-settings",
  "new-agent",
  "agent-settings",
  "new-app",
  "app-settings",
  "profile",
  "push-subscriptions",
  "person",
  "search",
  "dms",
  "people",
  "drafts",
  "threads",
  "files",
  "activity",
  "todos",
  "saved",
]);

/**
 * Starts loading the page at `pathname` when few visits need it, so that it's there by the time the workspace
 * shows, and returns what settles once it's loaded or failed to.
 */
export function loadPageAhead(pathname: string): Promise<unknown> {
  return RARE_PAGES.has(routeOf(pathname).page) ? loadRarePages().catch(() => {}) : Promise.resolve();
}

/**
 * What the rail marks on each page: the logo and Home at home, Home on a room's page and the pages that
 * go on to one, and on the Home sidebar's pages, DMs on the DMs page and a DM's settings, as on a DM's
 * own page, Search on search, Admin or Workspace on every page of community settings (a room's forms,
 * the bot and agent pages and the Custom CSS page among them), your avatar on your profile, and nothing
 * on your push subscriptions, whose address none of its links have, nor on New direct message's, which
 * goes on to the last room visited at once.
 */
const RAIL_PAGES = {
  home: "home",
  "newest-room": "room",
  room: "room",
  message: "room",
  "room-of-kind": "room",
  "new-room": "workspace",
  "room-settings": "workspace",
  "new-direct": null,
  "direct-settings": "dms",
  "workspace-settings": "workspace",
  "custom-styles": "workspace",
  bots: "workspace",
  "new-bot": "workspace",
  "bot-settings": "workspace",
  "new-agent": "workspace",
  "agent-settings": "workspace",
  "new-app": "workspace",
  "app-settings": "workspace",
  profile: "profile",
  "push-subscriptions": null,
  person: null,
  search: "search",
  dms: "dms",
  people: "home",
  drafts: "home",
  threads: "home",
  files: "files",
  activity: "activity",
  todos: "todos",
  saved: "home",
} as const satisfies Record<Route["page"], RailPage>;

/** The Home sidebar's link each of its pages marks. */
const SIDEBAR_PAGES: Partial<Record<Route["page"], SidebarPage>> = { people: "people", drafts: "drafts", threads: "threads", saved: "saved" };

/**
 * The pages a phone shows the tab bar on, as Slack's does: the tabs' own, conversations, whose composer
 * sits on it, people, search, and the pages Home's cards open. Threads, settings and forms take the
 * whole screen, with Back of their own.
 */
const TAB_BAR_PAGES = new Set<Route["page"]>(["home", "newest-room", "room", "message", "room-of-kind", "person", "search", "dms", "activity", "files", "people", "drafts", "threads", "todos", "saved"]);

/** The tab whose own page a route is on a phone, or null for a page that opens over the tabs. */
function ownTabOf(route: Route, path: string): Tab | null {
  if (route.page === "home") return path === "/" ? "home" : null;
  if (route.page === "dms") return route.roomId === undefined ? "dms" : null;
  if (route.page === "activity" || route.page === "files") return route.page;
  return null;
}

/** Loads the page shown again, for the Worker to answer it with Campfire's 404 page, as it does for someone nobody is. */
const showNotFound = () => loadPage(location.pathname);

/** An address the app goes on from, to `path`, with an alert to show there. */
interface Redirect {
  path: string;
  alert?: string;
}

/** The rooms, stars and shared order of someone whose rooms haven't loaded yet. */
const NO_ROOMS: SidebarRoom[] = [];
const NO_FAVORITES: Favorites = { rooms: [], version: 0 };
const NO_ORDER: RoomId[] = [];
const NO_PEOPLE: User[] = [];

/** What the page shows while its rooms, or the page itself, load. */
const LOADING = (
  <MainContent className="col-start-3 row-span-2 flex items-center justify-center bg-background text-muted-foreground max-md:col-start-1">Loading…</MainContent>
);

/** And a page of community settings, under the header and beside the links to their sections, which stay. */
const SETTINGS_LOADING = (
  <>
    <PageHeader />
    <MainContent className="flex items-center justify-center bg-background text-muted-foreground">Loading…</MainContent>
  </>
);

/** Where someone goes from a room they can't see. */
const ROOM_NOT_FOUND: Redirect = { path: "/", alert: "Room not found or inaccessible" };

/** What an alert says about a request that failed: the server's reason, or that Ember couldn't be reached. */
const reasonFor = (error: unknown) => (error instanceof ApiError ? error.message : "Couldn't reach Ember. Check your connection and try again.");

/**
 * The room an address names that has to be one of someone's rooms, which a direct message's address
 * doesn't, since the room's own address it goes on to checks.
 */
function namedRoomId(route: Route): RoomId | null {
  if (route.page === "room-of-kind") return route.kind !== "direct" ? route.roomId : null;
  if (route.page === "dms") return route.roomId ?? null;
  return route.page === "room" || route.page === "room-settings" || route.page === "direct-settings" ? route.roomId : null;
}

/** The DM `roomId` names among `rooms`, or null when it isn't one of them. */
function directIn(rooms: Room[], roomId: RoomId): DirectRoom | null {
  const room = rooms.find((r) => r.id === roomId);
  return room?.kind === "direct" ? room : null;
}

/**
 * Where an address goes on to once someone's rooms are known, or null when it shows a page of its own:
 * home to the last room visited, but on a phone, where home is the Home tab's list, `/rooms` to the
 * newest room, a room's address for its kind to the room's own, and a DM's settings home, unless it's
 * theirs. New direct message's goes home too, under the dialog it opens, and a message's own address goes
 * on to its permalink.
 */
function redirectOf(route: Route, rooms: SidebarRoom[], phone: boolean): Redirect | null {
  switch (route.page) {
    case "home": {
      if (phone) return null;
      // Home lists no DMs, so it goes on to the last room visited that isn't one.
      const room = lastChannelVisited(rooms);
      return room && { path: roomPath(room.id) };
    }
    case "newest-room":
      // With no room to go to, home says there are none.
      return { path: rooms.length > 0 ? roomPath(rooms.at(-1)!.id) : "/" };
    case "room-of-kind": {
      // A direct message's goes on without looking, and the room's own address checks it.
      if (route.kind === "direct") return { path: roomPath(route.roomId) };
      // A room this person can't see says so at its own address.
      const room = rooms.find((r) => r.id === route.roomId);
      return room?.kind === "direct" ? ROOM_NOT_FOUND : { path: roomPath(route.roomId) };
    }
    case "room":
      // A room this person can't see says so in its place.
      return null;
    // A DM beside the DMs page's list: a room that isn't a DM goes on to its own address.
    case "dms": {
      if (route.roomId === undefined) return null;
      const room = rooms.find((r) => r.id === route.roomId);
      return !room ? ROOM_NOT_FOUND : room.kind === "direct" ? null : { path: roomPath(room.id) };
    }
    case "message":
      // Without looking, as the permalink checks the room.
      return { path: route.messageId ? messagePath(route.roomId, route.messageId) : roomPath(route.roomId) };
    case "direct-settings":
      return directIn(rooms, route.roomId) ? null : ROOM_NOT_FOUND;
    case "new-direct":
      return { path: "/" };
    default:
      return null;
  }
}

/**
 * The drawer layout: `max-md`, 900px wide and below, where the rail and sidebar move into a drawer
 * opened from the header, or on a page of community settings, the rail alone. Phones, which take the
 * same width, have the tab bar instead (`PHONE_LAYOUT`), so the drawer never opens there.
 */
const DRAWER_LAYOUT = "(width < 56.3125rem)";

/** The signed-in layout: rail | sidebar | header over main, or the drawer layout. */
interface Props {
  me: Me;
  /** The workspace's name, which titles the rail's logo and heads the sidebar. */
  workspaceName: string;
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

export function Workspace({ me, workspaceName, onAccountChanged, onSignOut, onSessionChanged }: Props) {
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
  // Activity, which the workspace socket keeps current on every page, for the rail's count and its page.
  const activityFailed = useRef<(error: unknown) => void>(() => {});
  const activityFeed = useActivity(useCallback((error: unknown) => activityFailed.current(error), []));
  const { list, answered, change: changeRooms, refresh, askForRoom } = useSidebar(me, onSessionChanged, directory, accountHeard, shownRoomGone, activityFeed.heard);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // New direct message, while it's open, with the link that opened it, which gets focus back, or null
  // when its address did.
  const [newDirect, setNewDirect] = useState<{ opener: HTMLElement | null } | null>(null);
  const closeDrawerButton = useRef<HTMLButtonElement>(null);
  const drawerRail = useRef<HTMLDivElement>(null);
  const roomView = useRef<RoomViewHandle>(null);
  const route = useRoute();
  const hash = useHash();
  const phone = usePhoneLayout();
  // On a phone, the tab whose page is shown, or the one the page shown was opened from.
  const path = usePath();
  const ownTab = phone ? ownTabOf(route, path) : null;
  const [openedFromTab, setOpenedFromTab] = useState<Tab | null>(null);
  if (ownTab && ownTab !== openedFromTab) setOpenedFromTab(ownTab);
  // On a page of community settings, the links to their sections take the conversations' place.
  const section = settingsSectionOf(route, hash);
  const administrator = me.administrator;
  const settings = useMemo<SettingsPlace | null>(() => section && { section, administrator }, [section, administrator]);

  const rooms = list?.rooms ?? null;
  const invitation = list?.invitation ?? null;
  const favorites = list?.favorites ?? NO_FAVORITES;
  const sharedOrder = list?.sharedOrder ?? NO_ORDER;
  const starred = useMemo(() => new Set(favorites.rooms), [favorites]);
  // What a quote's cite names conversations by, and Forward message lists.
  const conversations = useMemo(() => ({ rooms: rooms ?? NO_ROOMS, meId: me.id }), [rooms, me.id]);
  // Not anyone the directory has heard is removed or banned since the list loaded.
  const listedSuggestions = list?.suggestions ?? NO_PEOPLE;
  const suggestions = useMemo(
    () => listedSuggestions.filter((person) => (directory.people.get(person.id)?.status ?? "active") === "active"),
    [listedSuggestions, directory.people],
  );

  // Crossing 900px, as a big phone does on its side, closes the drawer.
  // The wider layout has no drawer, and one left open would be hidden but still dim the page.
  useEffect(() => {
    const drawerLayout = matchMedia(DRAWER_LAYOUT);
    const close = () => setDrawerOpen(false);
    drawerLayout.addEventListener("change", close);
    return () => drawerLayout.removeEventListener("change", close);
  }, []);

  // Another page starts with the drawer closed.
  useEffect(() => setDrawerOpen(false), [route]);

  // The pages few visits need load once the rooms have, while the browser is idle, so that going to one
  // doesn't wait for them. If they fail to, the first page that needs them tries again.
  const listed = rooms !== null;
  useEffect(() => (listed ? whenIdle(() => void loadRarePages().catch(() => {})) : undefined), [listed]);
  // And for an administrator, whether a newer release of Ember is out, or for a beta the beta after it,
  // which the rail's Admin marks, asked afresh each time Admin opens, and by General's Check for updates.
  const { check: release, checkAgain: checkForUpdates } = useReleaseCheck(administrator, listed, settings !== null);
  const newRelease = (release && updateOf(release)?.release) ?? null;

  // On a phone, the drawer closes as New direct message opens.
  const openNewDirect = (opener: HTMLElement | null) => {
    setDrawerOpen(false);
    setNewDirect({ opener });
  };
  useLayoutEffect(() => {
    if (route.page === "new-direct") openNewDirect(null);
  }, [route]);

  // The search box, while it's open, with what it opened with. On a phone, the drawer closes as it opens.
  const [searchBox, setSearchBox] = useState<SearchBoxOptions | null>(null);
  const openSearch = useCallback((options: SearchBoxOptions) => {
    setDrawerOpen(false);
    setSearchBox(options);
  }, []);

  // The huddle this tab is in, and the preview one is started or joined from, while it's open, by its room.
  const huddle = useHuddle();
  const huddlesOn = useAccount().huddles;
  const [huddlePreview, setHuddlePreview] = useState<RoomId | null>(null);
  // Whether the keyboard shortcuts dialog is open.
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Whether the keyboard shortcuts have opened yet, which loads them.
  const [shortcutsShown, setShortcutsShown] = useState(false);
  if (shortcutsOpen && !shortcutsShown) setShortcutsShown(true);
  const closeHuddlePreview = useCallback(() => setHuddlePreview(null), []);
  const liveHuddles = list?.huddles ?? NO_HUDDLES;
  const huddles = useMemo<Huddles>(() => ({ live: liveHuddles, preview: setHuddlePreview }), [liveHuddles]);
  // Only a room that's still this person's, and only while huddles are on, has a preview to show.
  const previewedRoom = huddlePreview !== null && huddlesOn ? rooms?.find((r) => r.id === huddlePreview) : undefined;
  const previewed = previewedRoom?.kind === "direct" ? undefined : previewedRoom;
  useEffect(() => {
    if (huddlePreview !== null && rooms !== null && !previewed) setHuddlePreview(null);
  }, [huddlePreview, rooms, previewed]);

  const flash = useFlash();
  const mounted = useMounted();
  // Why the room ended this tab's huddle, when it does. Whoever's signed in next starts in none.
  useEffect(() => hearHuddleEnd((why) => flash("alert", why)), [flash]);
  useEffect(() => leaveHuddle, []);
  // What connecting a Memberful account came to, as the address Memberful sent this browser back to says.
  useEffect(() => {
    const message = takeMemberfulFlash();
    if (message) flash(message.kind, message.text);
  }, [flash]);
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
  useLayoutEffect(() => {
    activityFailed.current = failed;
  }, [failed]);
  const redirect = useCallback(
    ({ path, alert }: Redirect) => {
      navigate(path, { replace: true });
      if (alert) flash("alert", alert);
    },
    [flash],
  );
  const missing = useCallback(() => redirect(ROOM_NOT_FOUND), [redirect]);
  const huddlePreviewFailed = useCallback(
    (error: unknown) => {
      setHuddlePreview(null);
      failed(error);
    },
    [failed],
  );
  // A room just saved takes its place in the list, and one that's gone leaves it.
  const listRoom = useCallback((room: Room) => changeRooms({ type: "saved", room }), []);
  const unlistRoom = useCallback((roomId: RoomId) => changeRooms({ type: "gone", roomId }), []);
  // And the welcome card shows the join link as workspace settings last loaded or regenerated it.
  const joinCodeChanged = useCallback((joinCode: string) => changeRooms({ type: "join code", joinCode }), []);
  // Its × takes it away once the server has saved that, here, and in this person's other tabs as the
  // workspace socket tells them. One the server didn't save leaves it, saying why.
  const dismissCard = useCallback(async () => {
    try {
      await dismissInvitation();
      changeRooms({ type: "invitation dismissed" });
    } catch (error) {
      failed(error);
    }
  }, [failed]);
  const starredRooms = useCallback((favorites: Favorites) => changeRooms({ type: "starred", favorites }), []);
  // A save's answer can come after a newer order has loaded, so the rooms load again once it's taken.
  const reorderedRooms = useCallback(
    (sharedOrder: RoomId[]) => {
      changeRooms({ type: "reordered", sharedOrder });
      void refresh().catch((error) => mounted.current && isSignedOut(error) && onSessionChanged(null));
    },
    [refresh, onSessionChanged, mounted],
  );

  // A room found gone while it's shown stays on screen to say so until another page shows, whether its
  // own socket finds it gone or the workspace socket, which can hear first, says so. A DM's settings
  // stay too, which go home once their own deletion answers, as the workspace socket can tell of it first.
  const [gone, setGone] = useState<{ room: Room; route: Route; why: RoomGone } | null>(null);
  const roomGone = (room: Room, why: RoomGone) => {
    setGone({ room, route, why });
    unlistRoom(room.id);
  };
  const goneHere = gone?.route === route ? gone : null;
  const goneRoom = goneHere?.room ?? null;
  // A room that's gone has no tabs, so its address names none.
  const tabAddressed = new URLSearchParams(useQuery()).has("tab");
  useEffect(() => {
    if (goneHere && tabAddressed) navigate(addressShowing("messages"), { replace: true });
  }, [goneHere, tabAddressed]);
  // A room shown as gone that's listed again, as when someone is put back in it, shows as it is on a page
  // started afresh, since its own socket may have stopped. `returns` counts the rooms that came back so.
  const [returns, setReturns] = useState(0);
  const listedAgain = goneRoom !== null && rooms !== null && rooms.some((r) => r.id === goneRoom.id);
  useLayoutEffect(() => {
    if (!listedAgain) return;
    setGone(null);
    setReturns((returns) => returns + 1);
  }, [listedAgain]);

  // A room the list doesn't have may be one made, or opened to this person, since it came: the list is
  // asked for again, once each time an address naming it is visited, before a room's address counts as
  // naming a room they can't see, and so its settings, once saved, leave it where it was made rather
  // than last, as a room just made goes. The sidebar has one list on its way at a time, so an older one
  // can't take the place of a newer one, which has changes made here since, and this waits for one asked
  // for after the address was visited.
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
    () => (rooms && !askingAgain && !goneRoom && !unansweredHere ? redirectOf(route, rooms, phone) : null),
    [rooms, askingAgain, goneRoom, unansweredHere, route, phone],
  );
  // Before the page paints, so a page that only goes on to another doesn't show.
  useLayoutEffect(() => {
    if (goingOn) redirect(goingOn);
  }, [goingOn, redirect]);

  // The room the page shows: a room's page's, or the DM open beside the DMs page's list.
  const shownRoomId = route.page === "room" ? route.roomId : route.page === "dms" ? (route.roomId ?? null) : null;
  const room = shownRoomId === null || goingOn ? null : (goneRoom ?? rooms?.find((r) => r.id === shownRoomId) ?? null);
  // When the room shown was marked unread as of as it opened, for its timeline's New line, kept while it
  // stays open, though opening it reads it. Coming back to it with nothing new draws none.
  const [opened, setOpened] = useState<{ roomId: RoomId | null; newSince: string | null }>({ roomId: null, newSince: null });
  if (opened.roomId !== (room?.id ?? null)) {
    const listed = room && rooms?.find((r) => r.id === room.id);
    setOpened({ roomId: room?.id ?? null, newSince: (listed?.unread && listed.unreadSince) || null });
  }
  const direct = route.page !== "direct-settings" || goingOn || !rooms ? null : directIn(goneRoom ? [goneRoom] : rooms, route.roomId);
  // The workspace socket's news that a room is gone takes it out of the list, and the room or the DM's
  // settings shown stay. Declared as a function, so that `useSidebar` above can take it.
  function shownRoomGone(roomId: RoomId, lostAccess: boolean) {
    const shown = room ?? direct;
    if (shown?.id === roomId) setGone({ room: shown, route, why: lostAccess ? "lost access" : "deleted" });
  }
  // Go Back on the settings pages returns to the last room visited, or home when there's none.
  const lastRoom = rooms && lastRoomVisited(rooms);
  const back = lastRoom ? roomPath(lastRoom.id) : "/";
  const select = (roomId: string) => navigate(roomPath(roomId));
  // The DMs page's list opens a DM beside it, at its address there.
  const selectDirect = (roomId: string) => navigate(dmPath(roomId));
  // A suggestion, or the button on someone's page, starts the DM with its person, or opens the one they
  // have, and goes there, listing it as the server answers: to its own address, or the DMs page's.
  const startDirectWith = async (person: User, pathOf: (roomId: RoomId) => string = roomPath) => {
    const answered = askForRoom();
    const mark = pageMark();
    try {
      const room = await startDirect([person.id]);
      answered({ type: "saved", room });
      // A page the person has gone to meanwhile stays.
      if (!mounted.current || pageMark() !== mark) return false;
      navigate(pathOf(room.id));
      return true;
    } catch (error) {
      failed(error);
      return false;
    }
  };
  // Following a link in the drawer closes it: one to another page once that page shows, which unsaved
  // changes hold off while they're asked about, and one to the page shown at once. One the browser opens
  // somewhere else, such as in a new tab, leaves this page as it was, so the drawer stays open.
  const closeForLinkHere = (event: MouseEvent) => {
    // A link followed in place has kept the browser from following it.
    if (!event.defaultPrevented) return;
    const link = (event.target as Element).closest("a[href]");
    if (link instanceof HTMLAnchorElement && link.pathname === location.pathname) setDrawerOpen(false);
  };
  const currentRoomId = room?.id ?? null;
  const unreadConversations = (rooms ?? NO_ROOMS).filter((r) => markedUnread(r, currentRoomId)).length;

  // Someone's profile, open beside the room or Activity's conversation, as the address's `profile` says,
  // so a reload keeps it and Back closes it. Another profile takes its place in the history, and closing
  // it goes back, as Back would, to the page it opened on.
  const query = useQuery();
  const profileId = new URLSearchParams(query).get(PROFILE_PARAM);
  const profilePane: ProfilePane | null =
    route.page === "room" || route.page === "activity"
      ? {
          userId: profileId || null,
          open: (userId) => navigate(`${location.pathname}?${new URLSearchParams({ [PROFILE_PARAM]: userId })}`, { replace: profileId !== null }),
          close: () => returnTo(location.pathname),
          startDirect: startDirectWith,
        }
      : null;
  // Cmd+F or Ctrl+F opens the search box, as it opens Slack's: in the room shown, or with the search the
  // results page shows, or for everything. In a dialog, the search box among them, the key is the browser's.
  const findPressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || !opensFind(event)) return;
    if (event.target instanceof Element && event.target.closest("[role=dialog]")) return;
    event.preventDefault();
    // Before the sidebar has listed the rooms, the room the address names.
    if (route.page !== "search") return openSearch({ opener: null, roomId: currentRoomId ?? (rooms === null && route.page === "room" ? route.roomId : null) });
    const { search, sort } = searchOfQuery(new URLSearchParams(location.search));
    openSearch({ opener: null, search, sort });
  });
  // Slack's huddle keys: one mutes or unmutes the huddle the tab is in, wherever it's pressed, and the
  // other leaves it, or else starts or joins the huddle of the room shown, as the header's button does,
  // unless it's pressed in a dialog.
  const huddleKeyPressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    // Held down, the keys repeat, which counts as the one press: they'd mute and unmute by turns
    // otherwise, and leaving would go on to offer the room's huddle.
    const pressed = (act: () => void) => {
      event.preventDefault();
      if (!event.repeat) act();
    };
    if (togglesMute(event) && huddle) return pressed(() => muteHuddle(!huddle.muted));
    if (!togglesHuddle(event) || (event.target instanceof Element && event.target.closest("[role=dialog]"))) return;
    if (huddle) return pressed(leaveHuddle);
    if (!huddlesOn || !room || room.kind === "direct" || goneRoom) return;
    pressed(() => setHuddlePreview(room.id));
  });
  // Cmd+/ or Ctrl+/ opens the keyboard shortcuts: from the composer too, which has no
  // key of its own there, but not over another dialog, a native <dialog> like Notification setup included.
  const shortcutsPressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || !opensShortcuts(event)) return;
    if (event.target instanceof Element && event.target.closest("dialog, [role=dialog]")) return;
    event.preventDefault();
    setShortcutsOpen(true);
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      findPressed(event);
      huddleKeyPressed(event);
      shortcutsPressed(event);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  // A huddle's link shows its room and offers the huddle, unless the tab is in it. The address becomes
  // the room's, so that loading the page again, or coming back to it, doesn't offer it again.
  const followHuddleLink = useEffectEvent((room: Room) => {
    if (!huddlesOn) flash("alert", "Huddles are turned off.");
    else if (room.kind !== "direct" && huddle?.roomId !== room.id) setHuddlePreview(room.id);
    navigate(roomPath(room.id), { replace: true });
  });
  const huddleLinked = route.page === "room" && route.huddle === true && !goneRoom ? room : null;
  useLayoutEffect(() => {
    if (huddleLinked) followHuddleLink(huddleLinked);
  }, [huddleLinked]);

  // The app's badge counts the unread conversations, as badge_dot_controller.js counts the sidebar's unread
  // rows, once the server's list has come: the empty one a failed first load leaves knows nothing of
  // what's unread. The rail's Activity counts Activity's unread items.
  useAppBadge(answered ? unreadConversations : null);
  // A DM, and its settings, show beside the DMs page's list, as the DMs page does, and the rail marks DMs
  // for them; any other page shows beside Home's, which goes back to the last room it showed.
  const directsShown = route.page === "dms" || route.page === "direct-settings" || room?.kind === "direct";
  const channelShown = room && room.kind !== "direct" ? room.id : null;
  useEffect(() => {
    if (channelShown !== null) rememberLastChannel(channelShown);
  }, [channelShown]);
  // How many DMs there are, but the hidden ones, how many are unread, and how many unread messages they
  // have, as far as each counts them, or one for a DM marked unread without a count, which DMs on the rail
  // counts, as Slack's does.
  const directCounts = useMemo(() => {
    if (rooms === null) return null;
    const unread = apart(rooms).directs.filter((r) => markedUnread(r, currentRoomId));
    return { conversations: apart(rooms).directs.length, unread: unread.length, messages: unread.reduce((sum, r) => sum + (r.unreadCount ?? 1), 0) };
  }, [rooms, currentRoomId]);
  const draftCount = useDraftCount(me.id);
  // In the drawer layout the DMs page shows its list in the page itself, so the sidebar, hidden there,
  // doesn't draw it a second time.
  const directsInPage = useMediaQuery(DRAWER_LAYOUT) && route.page === "dms" && route.roomId === undefined;
  const rail = (
    <Rail
      me={me}
      workspaceName={workspaceName}
      current={room?.kind === "direct" ? "dms" : RAIL_PAGES[route.page]}
      activity={{ unread: activityFeed.feed.unread }}
      directsUnread={directCounts?.messages ?? 0}
      newRelease={newRelease}
    />
  );
  // The DMs page's list loads with the pages few visits need, which load once the rooms have, while the
  // browser is idle, so it's there by the time DMs is followed; until then its column is blank.
  const directsPane = (
    <RarePage
      show={({ DirectsColumn }) => (
        <DirectsColumn
          meId={me.id}
          rooms={rooms ?? NO_ROOMS}
          loaded={rooms !== null}
          onSignedOut={() => onSessionChanged(null)}
          suggestions={suggestions}
          currentRoomId={currentRoomId}
          unreadOnly={false}
          onSelect={selectDirect}
          onNewDirect={openNewDirect}
          onStartDirect={(person) => startDirectWith(person, dmPath)}
        />
      )}
      loading={<div className="h-full bg-surface" />}
      onFailed={failed}
    />
  );
  const sidebar = directsShown ? (
    directsPane
  ) : (
    <Sidebar
      workspaceName={workspaceName}
      meId={me.id}
      rooms={rooms ?? NO_ROOMS}
      loaded={rooms !== null}
      favorites={favorites}
      sharedOrder={sharedOrder}
      huddles={huddlesOn ? liveHuddles : NO_HUDDLES}
      currentRoomId={currentRoomId}
      currentPage={SIDEBAR_PAGES[route.page] ?? null}
      draftCount={draftCount}
      unreadOnly={false}
      onSelect={select}
      onStarred={starredRooms}
      onSessionChanged={onSessionChanged}
    />
  );
  // The Files page has its own column in the sidebar's place, as Slack's has.
  const filesNav =
    route.page === "files" ? <RarePage show={({ FilesNav }) => <FilesNav me={me} place={route.place} />} loading={null} onFailed={failed} /> : null;

  // On a phone, what's waiting on each tab, which the tab bar marks.
  const unreadRooms = (rooms ?? NO_ROOMS).filter((r) => markedUnread(r, currentRoomId));
  const tabNotices: TabNotices = {
    home: unreadRooms.some((r) => r.kind !== "direct") ? "Unread rooms" : undefined,
    dms: unreadRooms.some((r) => r.kind === "direct") ? "Unread DMs" : undefined,
    activity: activityFeed.feed.unread > 0 ? `${activityFeed.feed.unread} unread` : undefined,
  };

  /**
   * One of the pages few visits need, as `show` makes it once they've loaded. Keyed by the page, so that going on
   * from one that couldn't load them to another tries again.
   */
  const rarePage = (show: (pages: RarePages) => ReactNode) => (
    <RarePage key={route.page} show={show} loading={settings ? SETTINGS_LOADING : LOADING} onFailed={failed} />
  );
  /**
   * The room `place` names, in a pane of a page that opens conversations beside its list, as Activity and
   * Saved do, its thread put in another by `panes`; `key` tells one opening from another.
   */
  const roomPane = (rooms: SidebarRoom[], place: { roomId: RoomId; messageId?: string; threadId?: string; replyId?: string }, key: string, panes: RoomPanes) => {
    const shown = rooms.find((r) => r.id === place.roomId);
    return (
      shown && (
        <RoomView
          key={`${shown.id}/${key}`}
          room={shown}
          messageId={place.messageId}
          threadId={place.threadId}
          replyId={place.replyId}
          invitation={invitation?.roomId === shown.id ? invitation : null}
          onDismissInvitation={dismissCard}
          me={me}
          favorite={starred.has(shown.id)}
          onStarred={starredRooms}
          involvement={shown.involvement}
          askForRoom={askForRoom}
          onSessionChanged={onSessionChanged}
          onFailed={failed}
          onGone={(gone) => unlistRoom(gone.id)}
          panes={panes}
        />
      )
    );
  };
  const page = () => {
    switch (route.page) {
      case "new-room":
        // Not keyed, so flipping Everyone, which changes the address, keeps what's filled in.
        return rarePage(({ NewRoomPage }) => <NewRoomPage access={route.access} me={me} onCreated={listRoom} onFailed={failed} />);
      case "room-settings":
        return rarePage(({ RoomSettingsPage }) => (
          <RoomSettingsPage
            key={route.roomId}
            roomId={route.roomId}
            access={route.access}
            me={me}
            askForRoom={askForRoom}
            onMissing={missing}
            onFailed={failed}
          />
        ));
      case "workspace-settings":
        return rarePage(({ WorkspaceSettingsPage }) => (
          <WorkspaceSettingsPage
            me={me}
            back={back}
            askForAccount={askForAccount}
            onJoinCodeChanged={joinCodeChanged}
            reloadPeople={directory.reload}
            onPersonChanged={directory.update}
            onFailed={failed}
            rooms={rooms}
            sharedOrder={sharedOrder}
            onSharedOrderSaved={reorderedRooms}
            onSessionChanged={onSessionChanged}
            release={release}
            onCheckForUpdates={checkForUpdates}
          />
        ));
      case "custom-styles":
        return rarePage(({ CustomStylesPage }) => <CustomStylesPage askForAccount={askForAccount} onFailed={failed} />);
      case "bots":
        return rarePage(({ BotsPage }) => <BotsPage onFailed={failed} />);
      case "new-bot":
        return rarePage(({ NewBotPage }) => <NewBotPage me={me} onFailed={failed} />);
      case "bot-settings":
        return rarePage(({ BotSettingsPage }) => (
          <BotSettingsPage key={route.userId} botId={route.userId} onMissing={showNotFound} onFailed={failed} />
        ));
      case "new-agent":
        return rarePage(({ NewAgentPage }) => <NewAgentPage me={me} rooms={rooms} onFailed={failed} />);
      case "agent-settings":
        // @ember's page is its own, with what the Ember AI card held before there were agents.
        if (route.agentId === ASSISTANT_ID) return rarePage(({ EmberPage }) => <EmberPage me={me} onFailed={failed} />);
        return rarePage(({ AgentSettingsPage }) => (
          <AgentSettingsPage key={route.agentId} agentId={route.agentId} me={me} rooms={rooms} onMissing={showNotFound} onFailed={failed} />
        ));
      case "new-app":
        return rarePage(({ NewAppPage }) => <NewAppPage me={me} onFailed={failed} />);
      case "app-settings":
        return rarePage(({ AppSettingsPage }) => <AppSettingsPage key={route.appId} appId={route.appId} me={me} onMissing={showNotFound} onFailed={failed} />);
      case "profile":
        return rarePage(({ ProfilePage }) => <ProfilePage me={me} rooms={rooms} askForRoom={askForRoom} onSignOut={onSignOut} onFailed={failed} />);
      case "push-subscriptions":
        return rarePage(({ PushSubscriptionsPage }) => <PushSubscriptionsPage back={back} onFailed={failed} />);
      case "files":
        return rarePage(({ FilesPage }) => <FilesPage me={me} place={route.place} rooms={rooms ?? NO_ROOMS} onFailed={failed} />);
      case "search":
        return rarePage(({ SearchPage }) => <SearchPage me={me} rooms={rooms ?? NO_ROOMS} back={back} onFailed={failed} />);
      case "people":
        return rarePage(({ PeoplePage }) => <PeoplePage />);
      case "drafts":
        return rarePage(({ DraftsPage }) => <DraftsPage key={route.tab} me={me} tab={route.tab} rooms={rooms ?? NO_ROOMS} onFailed={failed} />);
      case "threads":
        return rarePage(({ ThreadsPage }) => <ThreadsPage me={me} rooms={rooms ?? NO_ROOMS} onFailed={failed} />);
      case "activity":
        if (!rooms) return LOADING;
        return rarePage(({ ActivityPage }) => (
          <ActivityPage
            me={me}
            place={route.roomId === undefined ? null : { roomId: route.roomId, messageId: route.messageId, threadId: route.threadId, replyId: route.replyId }}
            rooms={rooms}
            activity={activityFeed}
            renderRoom={(place, panes) => roomPane(rooms, place, "activity", panes)}
          />
        ));
      case "todos":
        return rarePage(({ TodosPage }) => <TodosPage itemId={route.itemId} me={me} rooms={rooms ?? NO_ROOMS} onFailed={failed} />);
      case "saved":
        return rarePage(({ SavedPage }) => (
          <SavedPage
            itemId={route.itemId}
            me={me}
            rooms={rooms ?? NO_ROOMS}
            onFailed={failed}
            renderRoom={(place, panes) => roomPane(rooms ?? NO_ROOMS, place, `saved/${route.itemId}`, panes)}
          />
        ));
      case "person":
        return rarePage(({ PersonPage }) => (
          <PersonPage
            key={route.userId}
            userId={route.userId}
            me={me}
            onStartDirect={startDirectWith}
            onPersonChanged={directory.update}
            reloadPeople={directory.reload}
            onMissing={showNotFound}
            onFailed={failed}
          />
        ));
      // The DMs page, with a DM picked there shown as a room's page shows it.
      case "dms":
      default:
        if (route.page === "dms" && route.roomId === undefined) return rarePage(({ DirectsHome }) => <DirectsHome list={directsPane} counts={directCounts} onNewDirect={openNewDirect} />);
        if (direct)
          return rarePage(({ DirectSettingsPage }) => (
            <DirectSettingsPage key={direct.id} room={direct} me={me} back={back} askForRoom={askForRoom} onMissing={missing} onFailed={failed} />
          ));
        // A room that's gone, or an address naming one this person can't see, says so in the room's place.
        if (route.page === "room" && goneHere) return <RoomUnavailable room={goneHere.room} gone={goneHere.why} goTo={lastRoom} me={me} />;
        if (route.page === "room" && !room && rooms && !askingAgain && !unansweredHere) return <RoomUnavailable room={null} gone="lost access" goTo={lastRoom} me={me} />;
        if (room)
          return (
            <RoomView
              key={`${room.id}/${returns}`}
              ref={roomView}
              room={room}
              messageId={route.page === "room" ? route.messageId : undefined}
              threadId={route.page === "room" ? route.threadId : undefined}
              replyId={route.page === "room" ? route.replyId : undefined}
              invitation={invitation?.roomId === room.id ? invitation : null}
              onDismissInvitation={dismissCard}
              me={me}
              favorite={starred.has(room.id)}
              onStarred={starredRooms}
              // As the list has it, or as it starts once the room has gone from the list.
              involvement={rooms?.find((r) => r.id === room.id)?.involvement ?? startingInvolvement(room)}
              newSince={opened.roomId === room.id ? opened.newSince : null}
              askForRoom={askForRoom}
              onSessionChanged={onSessionChanged}
              onFailed={failed}
              onGone={roomGone}
            />
          );
        // On a phone, Home's list, but for someone in no rooms yet, who has nothing to list.
        if (route.page === "home" && rooms && !goingOn) {
          if (phone && rooms.length > 0)
            return <HomePage me={me} workspaceName={workspaceName} sidebar={sidebar} huddles={liveHuddles} newRelease={newRelease} onNewDirect={openNewDirect} />;
          return <WelcomePage me={me} />;
        }
        // Why the room can't show, kept where it would show rather than in an alert that fades, as a
        // browser's own page says when a server can't be reached. The header keeps the way to the other
        // rooms on a phone.
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
        return LOADING;
    }
  };

  // The Sheet wraps the whole layout so the header's menu button can be its trigger, which gives it
  // aria-expanded and gets focus back to it when the drawer closes. The skip link comes first, and the
  // rail and conversations are landmarks in either layout. On a page of community settings, the header
  // spans the column beside the rail, 244px wide there, and the links to their sections, which it
  // brings, fill that column under it, or at 900px and below, a row of their own. The layout contains
  // and clips whatever is placed absolutely inside it, such as text for screen readers only, and can't
  // scroll itself. Otherwise that text, far down a long page, would reach past it and make the document
  // scrollable, so that a mouse wheel over the header, or a change of the address's fragment, would
  // scroll the whole layout up.
  const layout = (
    <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
      <DrawerOpen value={drawerOpen}>
        <div
          className={cn(
            // On a phone, it ends above the on-screen keyboard where that covers the page (`KeyboardInset`).
            "relative grid h-dvh max-md:h-[calc(100dvh-var(--keyboard-inset,0px))] grid-cols-[calc(var(--spacing-rail)+env(safe-area-inset-left))_var(--spacing-sidebar)_minmax(0,1fr)] grid-rows-[var(--spacing-header)_minmax(0,1fr)] overflow-clip bg-surface max-md:grid-cols-[minmax(0,1fr)] max-md:grid-rows-[calc(56px+env(safe-area-inset-top))_minmax(0,1fr)_auto]",
            settings && "[--spacing-sidebar:244px] max-md:grid-rows-[calc(56px+env(safe-area-inset-top))_auto_minmax(0,1fr)_auto]",
            // The DMs page's list, which shows each DM's latest message, is wider, as Slack's is.
            !settings && directsShown && "md:[--spacing-sidebar:340px]",
            // A thread or a profile open beside its room, from 1180px wide, which takes 420px of the room's
            // width until it's resized; a profile covers the thread, which keeps its place for when it closes.
            "min-[1180px]:has-[>[data-thread]]:grid-cols-[calc(var(--spacing-rail)+env(safe-area-inset-left))_var(--spacing-sidebar)_minmax(0,1fr)_var(--side-width,420px)]",
            "[&:has(>[data-profile])>[data-thread]:not([data-profile])]:hidden",
          )}
          onClickCapture={(event) => opensProfile(profilePane, event)}
        >
          <SkipLink />
          <div className="contents max-md:hidden [&>*]:row-span-2">
            {rail}
            {/* Activity's feed and To-dos' list take the conversations' place. */}
            {!settings && route.page !== "activity" && route.page !== "todos" && (
              <aside aria-label="Conversations" className="min-h-0 overflow-hidden border-r">
                {filesNav ?? (!directsInPage && sidebar)}
              </aside>
            )}
          </div>

          <SheetContent
            side="left"
            showCloseButton={false}
            // Opening it focuses its close button, or with the rail alone, its first link.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (settings ? drawerRail.current?.querySelector<HTMLElement>("a[href]") : closeDrawerButton.current)?.focus();
            }}
            // Closing gives focus back to the menu button once the drawer has slid away, but only if focus went
            // with it: by then New direct message's search, or whatever was tapped as it slid, can have it.
            onCloseAutoFocus={(event) => {
              const focused = document.activeElement;
              if (focused && focused !== document.body) event.preventDefault();
            }}
            onClick={closeForLinkHere}
            className="flex w-auto max-w-[calc(100dvw-16px)] flex-row gap-0 border-0 bg-surface p-0 shadow-none sm:max-w-[calc(100dvw-16px)] md:hidden"
          >
            <SheetTitle className="sr-only">{settings ? "Navigation" : "Conversations"}</SheetTitle>
            <SheetDescription className="sr-only">{settings ? "Ember’s pages" : "Rooms and direct messages"}</SheetDescription>
            <div ref={drawerRail} className="pt-[env(safe-area-inset-top)]">
              {rail}
            </div>
            {/* The drawer leaves at least 16px of the room showing. */}
            {!settings && (
              <aside aria-label="Conversations" className="relative w-sidebar min-w-0 overflow-hidden border-r pt-[env(safe-area-inset-top)]">
                {/* A 44px button clear of the status bar, first in the sidebar's tab order, with Iconoir's xmark. */}
                <SheetClose
                  ref={closeDrawerButton}
                  aria-label="Close conversations"
                  className="absolute top-[max(7px,env(safe-area-inset-top))] right-1 z-[2] flex size-11 items-center justify-center rounded-lg bg-surface hover:bg-hover"
                >
                  <Xmark className="size-5" />
                </SheetClose>
                {filesNav ?? sidebar}
              </aside>
            )}
          </SheetContent>

          {page()}
          {room && profilePane?.userId && (
            <RarePage
              show={({ ProfilePanel }) => <ProfilePanel key={profilePane.userId} userId={profilePane.userId!} me={me} pane={profilePane} placement="column" />}
              loading={null}
              onFailed={failed}
            />
          )}
          {phone && <KeyboardInset />}
          {phone && TAB_BAR_PAGES.has(route.page) && <TabBar current={tabOf(ownTab, openedFromTab, room?.kind === "direct")} notices={tabNotices} roomId={currentRoomId} />}
          <MovedNotice />
          {newDirect && (
            <RarePage
              show={({ NewDirectDialog }) => (
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
              loading={null}
              onFailed={failed}
            />
          )}
          {/* Once opened, it stays in the page, so it can animate as it shuts. */}
          {shortcutsShown && (
            <RarePage show={({ KeyboardShortcutsDialog }) => <KeyboardShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />} loading={null} onFailed={failed} />
          )}
          {searchBox && (
            <RarePage
              show={({ SearchBox }) => <SearchBox {...searchBox} me={me} rooms={rooms ?? NO_ROOMS} onClose={() => setSearchBox(null)} onFailed={failed} />}
              loading={null}
              onFailed={failed}
            />
          )}
          {previewed && (
            <RarePage
              show={({ HuddlePreview }) => <HuddlePreview key={previewed.id} room={previewed} me={me} live={liveHuddles[previewed.id]} onClose={closeHuddlePreview} />}
              loading={null}
              onFailed={huddlePreviewFailed}
            />
          )}
          {huddle && (
            <RarePage
              show={({ HuddleBar }) => <HuddleBar huddle={huddle} room={rooms?.find((r) => r.id === huddle.roomId) ?? null} meId={me.id} />}
              loading={null}
              onFailed={failed}
            />
          )}
        </div>
      </DrawerOpen>
    </Sheet>
  );
  return (
    <PeopleContext value={directory.people}>
      <DirectoryLoaded value={directory.loaded}>
        <SettingsLayout value={settings}>
          <OpenSearchContext value={openSearch}>
            <HuddlesContext value={huddles}>
              <ProfilePaneContext value={profilePane}>
                <ConversationsContext value={conversations}>
                  {/* For the phone's "You" sheet on every tab, which tells an administrator of a newer Ember. */}
                  <NewReleaseContext value={newRelease}>{layout}</NewReleaseContext>
                </ConversationsContext>
              </ProfilePaneContext>
            </HuddlesContext>
          </OpenSearchContext>
        </SettingsLayout>
      </DirectoryLoaded>
    </PeopleContext>
  );
}
