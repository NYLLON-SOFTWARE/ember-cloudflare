import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, startingInvolvement, type Account, type ActivityItem, type Bot, type DirectoryUser, type DirectRoom, type Me, type Message, type Room, type RoomId, type RoomSettings, type SharedRoom, type SidebarRoom, type TimelinePage, type WorkspaceServerFrame, type WorkspaceSettings } from "@ember/protocol";
import type { AgentSettings } from "@ember/protocol/agents";
import { THINKING_LEVELS, type AssistantSettings } from "@ember/protocol/assistant";
import { FlashProvider } from "@/components/flash";
import { AccountContext } from "@/hooks/use-account";
import { SHIPPED_MODELS } from "@/hooks/use-offered-models";
import { PushContext } from "@/hooks/use-push";
import { navigate } from "@/hooks/use-route";
import { joinHuddle } from "@/lib/huddle";
import { endHuddle, joinedHuddle, showHuddle, type HuddleControls } from "@/lib/huddle-store";
import { loadPage } from "@/lib/page";
import { badgeTheApp } from "@/test-badge";
import { answerConfirm } from "@/test-confirm";
import { PUSH_ON } from "@/test-push";
import { CONFIRM_DELETE_DIRECT } from "./direct-settings-page";
import { Workspace, loadPageAhead } from "./workspace";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));
// A huddle's own tests join one. Here joining shows the tab as in the huddle, as a test has it.
vi.mock("@/lib/huddle", () => ({ joinHuddle: vi.fn() }));

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const rooms: SharedRoom[] = [
  { id: "general", name: "general", kind: "open", icon: null },
  { id: "random", name: "random", kind: "open", icon: null },
];
/** When a message came that marks a room unread. */
const NOON = "2026-10-15T12:00:00.000Z";
/** Ada's DM with Grace. */
const withGrace: DirectRoom = { id: "d1", kind: "direct", members: [{ id: ada.id, name: ada.name }, { id: "u2", name: "Grace" }], activeAt: "2026-10-15T12:00:00.000Z" };
/**
 * The sidebar's list of `listed`, read and at the level each starts at unless it says otherwise, with the
 * rooms starred in `favorites`, and the ones the shared order ranks in `sharedOrder`.
 */
const roomList = (listed: Room[], favorites: RoomId[] = [], sharedOrder: RoomId[] = []) => ({
  rooms: listed.map((room) => ({ unread: false, involvement: startingInvolvement(room), ...room })),
  favorites: { rooms: favorites, version: 0 },
  sharedOrder,
  invitation: null,
  suggestions: [],
  huddles: {},
});
const generalSettings: RoomSettings = { room: rooms[0]!, canAdminister: true, people: [{ ...ada, member: true }], parents: [], subRooms: 0 };
const workspaceSettings: WorkspaceSettings = {
  account: { name: "Analytical Engines", tagline: "", hideTranslationButtons: true, customStyles: "", restrictRoomCreation: false, logo: null, customDomain: null, joinLink: true, openSignUp: false, memberfulJoin: false, memberfulSignIn: false, emailDomainSignUp: false, emailDomains: [], navigationIcons: {}, huddles: false },
  joinCode: "aB3d-Ef5h-iJ7k",
  canAdminister: false,
  memberfulSite: null,
  memberfulWebhooks: false,
  turnstile: null,
  assistant: null,
  huddles: null,
  cloudflareAccountId: null,
  email: { provider: "cloudflare", resendKey: null, cloudflare: true, from: null },
  invitations: [],
  emailDomains: [],
  addresses: { deployed: null, others: [] },
};

/**
 * Answers each request as `responses` says, by its method and path, such as "POST /api/rooms", with
 * the workspace's settings for "GET /api/account", nobody for "GET /api/users", no Activity for
 * "GET /api/activity", and the room list for anything else.
 */
function serve(responses: Record<string, () => Response | Promise<Response>> = {}) {
  const answers: typeof responses = {
    "GET /api/account": () => Response.json(workspaceSettings),
    "GET /api/users": () => Response.json({ users: [] }),
    "GET /api/directs": () => Response.json({ previews: [] }),
    "GET /api/threads": () => Response.json({ threads: [], next: null }),
    "GET /api/activity": () => Response.json({ items: [], unread: 0, more: false }),
    ...responses,
  };
  vi.mocked(fetch).mockImplementation(async (input, init) => (answers[`${init?.method ?? "GET"} ${String(input)}`] ?? (() => Response.json(roomList(rooms))))());
}

/** A socket that never connects: these tests are about the layout around the room. */
class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

/** Sockets that every room lets Ada into, with nothing said yet, so its composer loads its editor. */
class OpenRoomSocket extends QuietSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(url: string) {
    super();
    if (!url.includes("/api/rooms/")) return;
    setTimeout(() => {
      this.readyState = QuietSocket.OPEN;
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false }) });
    });
  }
}

/**
 * Sockets that `roomId`'s room closes as soon as they open, as it does for a room that's gone for this
 * person, after welcoming them with `messages` if there are any, as a room that goes while it's open does.
 */
function goneRoom(roomId: string, messages: Message[] = []) {
  return class extends QuietSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    constructor(url: string) {
      super();
      if (!url.includes(`/api/rooms/${roomId}/socket`)) return;
      setTimeout(() => {
        this.onopen?.();
        if (messages.length > 0) this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada, messages, present: [ada], hasMore: false }) });
        this.onclose?.({ code: CloseCode.NotFound });
      });
    }
  };
}

/** The workspace socket, which welcomes Ada, then brings what a test has it bring. */
class WorkspaceSocket extends QuietSocket {
  static last: WorkspaceSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(url: string) {
    super();
    if (!url.includes("/api/socket")) return;
    WorkspaceSocket.last = this;
    setTimeout(() => {
      this.onopen?.();
      this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada }) });
    });
  }
}

/** The workspace at `path`, for `me`, in a workspace that's as one is before first run unless `account` says how it is. */
function showWorkspace(path = "/", me = ada, account?: Account) {
  const [onAccountChanged, onSignOut, onSessionChanged] = [vi.fn(), vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  const workspace = (
    <Workspace me={me} workspaceName="Analytical Engines" onAccountChanged={onAccountChanged} onSignOut={onSignOut} onSessionChanged={onSessionChanged} />
  );
  const { unmount } = render(
    <PushContext value={PUSH_ON}>
      <FlashProvider workspace>{account ? <AccountContext value={account}>{workspace}</AccountContext> : workspace}</FlashProvider>
    </PushContext>,
  );
  return { onAccountChanged, onSignOut, onSessionChanged, unmount, user: userEvent.setup() };
}

const roomHeading = () => screen.findByRole("heading", { level: 1 });
/** The rooms in the sidebar, in order. */
/** The sidebar's rooms by name, with a ★ after each starred one. */
const sidebarRooms = () =>
  within(screen.getByRole("complementary", { name: "Conversations" })).getAllByRole("region", { name: /^(Starred|Rooms)$/ }).flatMap((region) => within(region).queryAllByRole("link").map((link) => [link, region] as const))
    .map(([link, region]) => link.textContent!.replace(/^#/, "") + (within(region).queryByRole("button", { name: "Starred" }) ? "★" : ""));
/** The rail's links for the page shown, if any. */
const railCurrent = () =>
  within(screen.getByRole("navigation", { name: "Workspace" }))
    .queryAllByRole("link", { current: "page" })
    .map((link) => link.getAttribute("aria-label") ?? link.textContent);
/** How many times the room list was asked for. */
const roomListRequests = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/sidebar").length;
/** Community settings' heading for the section of workspace settings that's shown first. */
const communitySettings = () => screen.findByRole("heading", { level: 1, name: "Basic community settings" });

/** Has the workspace socket bring `frame`, once it has welcomed Ada and asked for her rooms again. */
async function workspaceSends(frame: WorkspaceServerFrame) {
  await waitFor(() => expect(roomListRequests()).toBe(2));
  act(() => WorkspaceSocket.last!.onmessage?.({ data: JSON.stringify(frame) }));
}

// The pages few visits need show at once here, as they do once they've loaded soon after the workspace
// shows. pages.test.tsx tests them loading.
beforeAll(() => loadPageAhead("/searches"), 120_000);

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietSocket);
  vi.spyOn(globalThis, "fetch");
  serve();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe("Open a room", () => {
  it("opens the room in the address, named in the tab", async () => {
    showWorkspace("/rooms/random");
    expect(await roomHeading()).toHaveTextContent("random");
    await waitFor(() => expect(document.title).toBe("random"));
  });

  it("says so in the room's place at a room you can't see, once the list, asked again, hasn't got it either, with a way to a room you can", async () => {
    const { user } = showWorkspace("/rooms/secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You don’t have access to this room");
    expect(location.pathname).toBe("/rooms/secret");
    expect(roomListRequests()).toBe(2);
    await user.click(screen.getByRole("button", { name: "Go to #general" }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
  });

  it("keeps one socket to the room as its tabs, their panels and its members open and close (D5)", async () => {
    const opened: string[] = [];
    vi.stubGlobal(
      "WebSocket",
      class extends OpenRoomSocket {
        constructor(url: string) {
          super(url);
          if (url.includes("/api/rooms/random/")) opened.push(url);
        }
      },
    );
    serve({ "GET /api/rooms/random/library": () => Response.json({ files: [], links: [] }), "GET /api/rooms/random/tabs": () => Response.json({ tabs: [] }) });
    const user = userEvent.setup();
    showWorkspace("/rooms/random");
    expect(await screen.findByRole("textbox", { name: "Write a message" }, { timeout: 15_000 })).toBeInTheDocument();
    for (let round = 0; round < 2; round++) {
      await user.click(screen.getByRole("tab", { name: "Files & links" }));
      await screen.findByRole("tabpanel", { name: "Files & links" }, { timeout: 5000 });
      await user.click(screen.getByRole("tab", { name: "Messages" }));
      await user.click(screen.getByRole("button", { name: /^View members/ }));
      await user.keyboard("{Escape}");
    }
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opened).toHaveLength(1);
  });

  it("opens a room made since the list came, which the list asked again has", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    const lists = [roomList(rooms), roomList([...rooms, design])];
    serve({ "GET /api/sidebar": () => Response.json(lists.shift()) });
    showWorkspace("/rooms/design");
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(sidebarRooms()).toEqual(["Design", "general", "random"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for the list again each time the address names a room it hasn't got", async () => {
    const { user } = showWorkspace("/rooms/secret");
    await screen.findByRole("alert");
    act(() => navigate("/rooms/general"));
    expect(await roomHeading()).toHaveTextContent("general");
    act(() => navigate("/rooms/secret"));
    await waitFor(() => expect(roomListRequests()).toBe(3));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    // A room it has asks nothing.
    await user.click(within(screen.getByRole("region", { name: "Rooms" })).getByRole("link", { name: /random/ }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(roomListRequests()).toBe(3);
  });

  it("stays at a room's address, saying Ember can't be reached, when the list can't be asked for again", async () => {
    const answers = [() => Response.json(roomList(rooms)), () => Promise.reject(new TypeError("Failed to fetch"))];
    serve({ "GET /api/sidebar": () => answers.shift()!() });
    showWorkspace("/rooms/design");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");
    // In the page, where it stays while the page does, rather than in an alert that fades.
    expect(screen.getByRole("main")).toContainElement(alert);
    // For trying again, and with the header's way to the other rooms.
    expect(location.pathname).toBe("/rooms/design");
    expect(screen.getByRole("button", { name: "Open conversations" })).toBeInTheDocument();
  });

  it("asks for the list again when you try again, once it couldn't be asked for", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    const answers = [() => Response.json(roomList(rooms)), () => Promise.reject(new TypeError("Failed to fetch")), () => Response.json(roomList([...rooms, design]))];
    serve({ "GET /api/sidebar": () => answers.shift()!() });
    const { user } = showWorkspace("/rooms/design");
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(roomListRequests()).toBe(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("asks for the list again only once the list it last asked for has come", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    let answer = (_: Response) => {};
    const answers = [() => Response.json(roomList(rooms)), () => new Promise<Response>((resolve) => (answer = resolve)), () => Response.json(roomList([...rooms, design]))];
    serve({ "GET /api/sidebar": () => answers.shift()!() });
    showWorkspace("/rooms/secret");
    await waitFor(() => expect(roomListRequests()).toBe(2));
    act(() => navigate("/rooms/design"));
    // So an older list can't take the place of a newer one, losing changes made since it was asked for.
    expect(roomListRequests()).toBe(2);
    await act(async () => answer(Response.json(roomList(rooms))));
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(roomListRequests()).toBe(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Go back to the last room", () => {
  it("goes from / to the room visited last", async () => {
    showWorkspace("/rooms/random");
    await roomHeading();
    act(() => navigate("/"));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("goes from / to your oldest room when you haven't visited one, which isn't the first by name", async () => {
    const zebra: Room = { id: "zebra", name: "Zebra", kind: "closed", icon: null };
    serve({ "GET /api/sidebar": () => Response.json(roomList([zebra, ...rooms])) });
    showWorkspace("/");
    expect(await roomHeading()).toHaveTextContent("Zebra");
    expect(location.pathname).toBe("/rooms/zebra");
    expect(sidebarRooms()).toEqual(["general", "random", "Zebra"]);
  });

  it("says there are no rooms yet, with your name for screen readers, under Home", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([])) });
    showWorkspace("/");
    await waitFor(() => expect(document.title).toBe("No rooms yet"));
    expect(screen.getByRole("main")).toHaveTextContent("Ada");
    expect(screen.getByRole("main").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(location.pathname).toBe("/");
    expect(railCurrent()).toEqual(["Ember home", "Home"]);
  });

  it("goes back from workspace settings to the room visited last, by way of a room's settings", async () => {
    serve({ "GET /api/rooms/general/settings": () => Response.json(generalSettings) });
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    act(() => navigate("/rooms/opens/general/edit"));
    await screen.findByRole("textbox", { name: "Room name" });
    // To Rooms and permissions.
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Room order and permissions" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("goes back home from workspace settings when you have no rooms", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([])) });
    showWorkspace("/account/edit");
    await waitFor(() => expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/"));
  });
});

describe("Room addresses", () => {
  it("goes from /rooms to the room made most recently", async () => {
    showWorkspace("/rooms");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("goes from /rooms home when you have no rooms", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([])) });
    showWorkspace("/rooms");
    await waitFor(() => expect(location.pathname).toBe("/"));
    expect(document.title).toBe("No rooms yet");
  });

  it("goes from a room's address for its kind to the room's own, and remembers it", async () => {
    showWorkspace("/rooms/opens/random");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
    act(() => navigate("/"));
    await waitFor(() => expect(location.pathname).toBe("/rooms/random"));
  });

  it("goes from the address for a kind of room you can't see to the room's own, which says so", async () => {
    showWorkspace("/rooms/closeds/secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    expect(location.pathname).toBe("/rooms/secret");
  });

  it("goes from a direct message's address to the room's own without looking, which then looks", async () => {
    showWorkspace("/rooms/directs/random");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("reads /rooms/opens as a room's id", async () => {
    showWorkspace("/rooms/opens");
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    expect(location.pathname).toBe("/rooms/opens");
  });
});

describe("Create an open room", () => {
  it("makes a room from workspace settings, lists it in its place by name, and opens it", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }),
      "POST /api/rooms": () => Response.json({ room: design }, { status: 201 }),
    });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(await communitySettings()).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Rooms and permissions" }));
    await user.click(screen.getByRole("link", { name: "New room" }));
    const name = await screen.findByRole("textbox", { name: "Room name" });
    await user.clear(name);
    await user.type(name, "Design{Enter}");

    await waitFor(() => expect(location.pathname).toBe("/rooms/design"));
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(sidebarRooms()).toEqual(["Design", "general", "random"]);
  });

  it("lists a room made before the room list arrived, which the list may not have yet", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    let answer = (_: Response) => {};
    serve({
      "GET /api/sidebar": () => new Promise((resolve) => (answer = resolve)),
      "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }),
      "POST /api/rooms": () => Response.json({ room: design }, { status: 201 }),
    });
    const { user } = showWorkspace("/rooms/opens/new");
    await user.type(await screen.findByRole("textbox", { name: "Room name" }), "{Enter}");
    await waitFor(() => expect(location.pathname).toBe("/rooms/design"));
    // The list answers as it was before the room was made.
    await act(async () => answer(Response.json(roomList(rooms))));
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(sidebarRooms()).toEqual(["Design", "general", "random"]);
  });
});

describe("Room settings page", () => {
  it("opens a room's settings from its header, and shows the room again under the name saved", async () => {
    serve({
      "GET /api/rooms/general/settings": () => Response.json(generalSettings),
      "PATCH /api/rooms/general": () => Response.json({ room: { ...rooms[0], name: "lobby" } }),
    });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Settings for this room" }));
    expect(location.pathname).toBe("/rooms/opens/general/edit");
    const name = await screen.findByRole("textbox", { name: "Room name" });
    expect(screen.getByRole("heading", { level: 1, name: "Room settings" })).toBeInTheDocument();
    // Part of community settings, whose links take the sidebar's place.
    expect(screen.queryByRole("complementary", { name: "Conversations" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Community settings" })).getByRole("link", { current: "page" })).toHaveTextContent("Rooms and permissions");
    await user.clear(name);
    await user.type(name, "lobby{Enter}");

    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
    expect(await roomHeading()).toHaveTextContent("lobby");
    expect(sidebarRooms()).toEqual(["lobby", "random"]);
  });

  it("keeps a room opened to you since the list came where it was made, once you save its settings", async () => {
    const older: Room = { id: "older", name: "older", kind: "closed", icon: null };
    const lists = [roomList(rooms)];
    serve({
      "GET /api/sidebar": () => Response.json(lists.shift() ?? roomList([older, ...rooms])),
      "GET /api/rooms/older/settings": () => Response.json({ room: older, canAdminister: true, people: [{ ...ada, member: true }], parents: [], subRooms: 0 }),
      "PATCH /api/rooms/older": () => Response.json({ room: { ...older, name: "elder" } }),
    });
    const { user } = showWorkspace("/rooms/closeds/older/edit");
    const name = await screen.findByRole("textbox", { name: "Room name" });
    await user.clear(name);
    await user.type(name, "elder{Enter}");
    expect(await roomHeading()).toHaveTextContent("elder");
    // The room made last is still the newest.
    act(() => navigate("/rooms"));
    expect(await roomHeading()).toHaveTextContent("random");
  });

  it("goes back to Rooms and permissions, wherever it was opened from", async () => {
    serve({ "GET /api/rooms/random/settings": () => Response.json({ ...generalSettings, room: rooms[1] }) });
    const { user } = showWorkspace("/rooms/random");
    await user.click(await screen.findByRole("link", { name: "Settings for this room" }));
    await screen.findByRole("textbox", { name: "Room name" });
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Room order and permissions" })).toBeInTheDocument();
    expect(location.pathname + location.hash).toBe("/account/edit#channel-settings");
  });
});

describe("Who can change a room", () => {
  it("goes home with an alert from the settings of a room that isn't there, or isn't yours", async () => {
    serve({ "GET /api/rooms/secret/settings": () => Response.json({ error: "Room not found or inaccessible" }, { status: 404 }) });
    showWorkspace("/rooms/opens/secret/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
  });
});

describe("Add and remove private room members", () => {
  it("goes home with an alert when you save a room without yourself, and it leaves the sidebar", async () => {
    const leadsRoom: Room = { id: "leads", name: "Leads", kind: "closed", icon: null };
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, leadsRoom])),
      "GET /api/rooms/leads/settings": () => Response.json({ room: leadsRoom, canAdminister: true, people: [{ ...ada, member: true }], parents: [], subRooms: 0 }),
      "PATCH /api/rooms/leads": () => Response.json({ room: leadsRoom }),
    });
    const { user } = showWorkspace("/rooms/closeds/leads/edit");
    await user.click(await screen.findByRole("switch", { name: "Give Ada access to this room" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
    expect(sidebarRooms()).toEqual(["general", "random"]);
  });
});

describe("Only members see a room", () => {
  it("says in its place that a room that's gone was deleted, and takes it out of the sidebar", async () => {
    vi.stubGlobal("WebSocket", goneRoom("random"));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    const { user } = showWorkspace("/rooms/random");
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));
    expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#random was deleted");
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Star/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to #general" })).toBeInTheDocument();

    vi.stubGlobal("WebSocket", OpenRoomSocket);
    await user.click(within(screen.getByRole("region", { name: "Rooms" })).getByRole("link", { name: /general/ }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #general");
  });

  it("takes away the messages of a room that's gone", async () => {
    const said: Message = { id: "m1", clientMessageId: "c1", roomId: "random", creator: ada, body: "<p>Before it went</p>", plainText: "Before it went", mentions: [], createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z", editedAt: null, boosts: [] };
    vi.stubGlobal("WebSocket", goneRoom("random", [said]));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/rooms/random");
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));
    expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted");
    expect(screen.queryByText("Before it went")).not.toBeInTheDocument();
  });

  it("keeps a room / went to on screen when it goes, without asking for the list again", async () => {
    vi.stubGlobal("WebSocket", goneRoom("general"));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/");
    await waitFor(() => expect(sidebarRooms()).toEqual(["random"]));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("#general was deleted");
    expect(location.pathname).toBe("/rooms/general");
    expect(roomListRequests()).toBe(1);
  });
});

describe("Link to a message", () => {
  /** A room's socket, which keeps what it's sent, and which the test lets in. */
  class RoomSocket {
    static readonly OPEN = 1;
    static last: RoomSocket | null = null;
    readyState = 0;
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(readonly url: string) {
      if (url.includes("/api/rooms/")) RoomSocket.last = this;
    }
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    close() {}
    letIn(page: Partial<TimelinePage> = {}) {
      act(() => {
        this.readyState = RoomSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false, hasNewer: false, around: null, seq: 0, ...page }) });
      });
    }
  }

  it("goes to the message whose permalink is followed while the room is away, once the room lets the page in", async () => {
    vi.stubGlobal("WebSocket", RoomSocket);
    showWorkspace("/rooms/general");
    await roomHeading();
    act(() => navigate("/rooms/general/@m1"));
    const room = RoomSocket.last!;
    expect(room.sent).toEqual([]);
    room.letIn();
    expect(room.sent).toContainEqual({ type: "history.around", messageId: "m1" });
  });

  it("leaves the room at the message whose permalink it opened at as a thread opens there, rather than going to the newest", async () => {
    vi.stubGlobal("WebSocket", RoomSocket);
    showWorkspace("/rooms/general/@m1");
    await roomHeading();
    const room = RoomSocket.last!;
    const linked: Message = { id: "m1", clientMessageId: "c1", roomId: "general", creator: ada, body: "<p>Linked</p>", plainText: "Linked", mentions: [], createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z", editedAt: null, boosts: [] };
    room.letIn({ messages: [linked], hasNewer: true, around: "m1" });

    act(() => navigate("/rooms/general/threads/m1"));
    expect(await screen.findByRole("complementary", { name: "Thread" })).toBeInTheDocument();
    // The thread opens in an effect, which can run after the panel shows.
    await waitFor(() => expect(room.sent).toContainEqual({ type: "thread.open", parentId: "m1" }));
    expect(room.sent).not.toContainEqual({ type: "history.around" });
  });

  it("leaves the room's messages where they are as another of its tabs shows, and Messages again", async () => {
    vi.stubGlobal("WebSocket", RoomSocket);
    serve({ "GET /api/rooms/general/library": () => Response.json({ files: [], links: [] }) });
    showWorkspace("/rooms/general");
    await roomHeading();
    const room = RoomSocket.last!;
    const older: Message = { id: "m1", clientMessageId: "c1", roomId: "general", creator: ada, body: "<p>Older</p>", plainText: "Older", mentions: [], createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z", editedAt: null, boosts: [] };
    // Reading older history, which going to the newest would ask the room for again.
    room.letIn({ messages: [older], hasNewer: true });

    await userEvent.click(screen.getByRole("tab", { name: "Files & links" }));
    expect(location.pathname + location.search).toBe("/rooms/general?tab=files");
    await userEvent.click(screen.getByRole("tab", { name: "Messages" }));
    expect(location.pathname + location.search).toBe("/rooms/general");
    expect(room.sent).not.toContainEqual(expect.objectContaining({ type: "history.around" }));
  });

  it("says what the room has to over a thread that covers it, as why it refused something done in the thread", async () => {
    vi.stubGlobal("WebSocket", RoomSocket);
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(width < 73.75rem)", media, addEventListener() {}, removeEventListener() {} }));
    showWorkspace("/rooms/general/threads/m1");
    await roomHeading();
    const thread = screen.getByRole("complementary", { name: "Thread" });
    const room = RoomSocket.last!;
    room.letIn();
    act(() => room.onmessage?.({ data: JSON.stringify({ type: "error", message: "You can only edit your own messages", failed: "message.update" }) }));
    expect(within(thread).getByRole("alert")).toHaveTextContent("You can only edit your own messages");
    await userEvent.click(within(thread).getByRole("button", { name: "Dismiss" }));
    expect(within(thread).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes from a message's own address to its permalink, which opens the room around it", async () => {
    vi.stubGlobal("WebSocket", RoomSocket);
    showWorkspace("/rooms/general/messages/m1");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general/@m1");
    expect(RoomSocket.last!.url).toContain("&around=m1");
    expect(railCurrent()).toEqual(["Home"]);
  });

  it("goes from the address of a message with a malformed id to its room, and says so at one in a room you can't see", async () => {
    showWorkspace("/rooms/random/messages/%FF");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");

    act(() => navigate("/rooms/secret/messages/m1"));
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    expect(location.pathname).toBe("/rooms/secret/@m1");
  });
});

describe("Group DMs and DM names", () => {
  it("names a DM for the others in it, in its header, the tab, its messages and the composer", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({ "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])) });
    showWorkspace("/rooms/d1");
    expect(await roomHeading()).toHaveTextContent(/^Direct message with Grace$/);
    await waitFor(() => expect(document.title).toBe("Grace"));
    expect(screen.getByRole("log", { name: "Messages with Grace" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message Grace");
  });
});

describe("DMs page", () => {
  const dmsList = () => screen.getByRole("region", { name: "Direct messages" });
  /** A message Ada wrote, at noon. */
  const sentMessage = (id: string, plainText: string): Message => ({ id, clientMessageId: id, roomId: "general", creator: ada, body: `<p>${plainText}</p>`, plainText, mentions: [], createdAt: NOON, updatedAt: NOON, editedAt: null, boosts: [] });

  it("lists the DMs once in the drawer layout, in the page, where the sidebar's hidden", async () => {
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(width < 56.3125rem)", media, addEventListener() {}, removeEventListener() {} }));
    serve({ "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])) });
    showWorkspace("/dms");
    expect(await screen.findByRole("link", { name: "Direct message with Grace" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Direct messages" })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Direct messages" }).closest("aside")).toBeNull();
  });

  it("opens from the rail's DMs, beside the list of DMs, and shows a DM picked there beside the list, marking DMs", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])),
      "GET /api/directs": () => Response.json({ previews: [{ roomId: "d1", latest: { ...sentMessage("m1", "see you at noon"), roomId: "d1" }, unread: 0 }] }),
    });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    // Home lists no DMs.
    expect(screen.queryByRole("link", { name: /^Direct message with / })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "DMs" }));
    expect(location.pathname).toBe("/dms");
    expect(screen.getByRole("link", { name: "DMs" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 1, name: "Direct messages" })).toBeInTheDocument();
    expect(screen.getByText(/^\d+ conversations?/)).toBeInTheDocument();
    expect(await within(dmsList()).findByText("You: see you at noon")).toBeInTheDocument();

    await user.click(within(dmsList()).getByRole("link", { name: "Direct message with Grace" }));
    expect(await roomHeading()).toHaveTextContent("Direct message with Grace");
    expect(location.pathname).toBe("/dms/d1");
    expect(within(dmsList()).getByRole("link", { name: "Direct message with Grace" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "DMs" })).toHaveAttribute("aria-current", "page");

    // Home goes back to the last room it showed, not the DM.
    await user.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
    expect(screen.queryByRole("region", { name: "Direct messages" })).not.toBeInTheDocument();
  });

  it("shows a DM at its address on the DMs page, a room that isn't a DM at its own, and goes home from one that isn't yours", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])) });
    showWorkspace("/dms/d1");
    expect(await roomHeading()).toHaveTextContent("Direct message with Grace");
    expect(within(dmsList()).getByRole("link", { name: "Direct message with Grace" })).toHaveAttribute("href", "/dms/d1");
    expect(within(dmsList()).getByRole("link", { name: "Direct message with Grace" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "DMs" })).toHaveAttribute("aria-current", "page");

    act(() => navigate("/dms/random"));
    await waitFor(() => expect(location.pathname).toBe("/rooms/random"));
    act(() => navigate("/dms/d9"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    // Home, which goes back to the last room it showed.
    await waitFor(() => expect(location.pathname).toBe("/rooms/random"));
  });

  it("keeps New direct message at its address, over the last room visited", async () => {
    showWorkspace("/rooms/directs/new");
    expect(await screen.findByRole("dialog", { name: "New direct message" })).toBeInTheDocument();
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
  });
});

describe("Home sidebar pages", () => {
  it("opens Threads, Drafts & sent and People from Home's links, marking the link and Home", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Threads" }));
    expect(location.pathname).toBe("/threads");
    expect(await screen.findByRole("heading", { name: "No threads yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Threads" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("link", { name: "Drafts & sent" }));
    expect(screen.getByRole("heading", { level: 1, name: "Drafts & sent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No drafts" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "People" }));
    expect(location.pathname).toBe("/people");
    expect(screen.getByRole("searchbox", { name: "Search for people" })).toBeInTheDocument();
  });
});

describe("Delete a direct message", () => {
  it("deletes a DM from the settings its header opens, going home without an alert", async () => {
    const confirm = vi.spyOn(window, "confirm");
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])),
      "DELETE /api/rooms/d1": () => new Response(null, { status: 204 }),
    });
    const { user } = showWorkspace("/rooms/d1");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Settings for this DM" }));
    expect(location.pathname).toBe("/rooms/directs/d1/edit");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Edit settings for Grace");
    await user.click(screen.getByRole("button", { name: "Delete DM" }));
    await answerConfirm(user, CONFIRM_DELETE_DIRECT, "Delete");

    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    act(() => navigate("/dms"));
    expect(within(screen.getByRole("region", { name: "Direct messages" })).queryAllByRole("link", { name: /^Direct message with / })).toEqual([]);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("goes home without an alert when the workspace socket tells of the deletion before it answers", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    let answer = (_: Response) => {};
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])),
      "DELETE /api/rooms/d1": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const { user } = showWorkspace("/rooms/directs/d1/edit");
    await user.click(await screen.findByRole("button", { name: "Delete DM" }));
    await answerConfirm(user, CONFIRM_DELETE_DIRECT, "Delete");
    await workspaceSends({ type: "room.gone", roomId: "d1" });
    // The page stays as it was until its deletion answers.
    expect(screen.getByRole("button", { name: "Delete DM" })).toBeDisabled();
    expect(location.pathname).toBe("/rooms/directs/d1/edit");

    await act(async () => answer(new Response(null, { status: 204 })));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the settings of a DM someone else deletes on screen, going home with the alert once Delete finds it gone", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])),
      "DELETE /api/rooms/d1": () => Response.json({ error: "Room not found or inaccessible" }, { status: 404 }),
    });
    const { user } = showWorkspace("/rooms/directs/d1/edit");
    await screen.findByRole("button", { name: "Delete DM" });
    expect(within(screen.getByRole("region", { name: "Direct messages" })).queryAllByRole("link", { name: /^Direct message with / })).toHaveLength(1);
    await workspaceSends({ type: "room.gone", roomId: "d1" });
    expect(within(screen.getByRole("region", { name: "Direct messages" })).queryAllByRole("link", { name: /^Direct message with / })).toEqual([]);
    expect(location.pathname).toBe("/rooms/directs/d1/edit");

    await user.click(screen.getByRole("button", { name: "Delete DM" }));
    await answerConfirm(user, CONFIRM_DELETE_DIRECT, "Delete");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
  });

  it("goes home with an alert from the settings of a DM you aren't in, or of a room that isn't a DM", async () => {
    showWorkspace("/rooms/directs/d9/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(roomListRequests()).toBe(2);

    act(() => navigate("/rooms/directs/random/edit"));
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
    expect(screen.getAllByRole("alert").at(-1)).toHaveTextContent("Room not found or inaccessible");
  });
});

describe("New direct message dialog", () => {
  const people: DirectoryUser[] = [ada, withGrace.members[1]!].map(({ id, name }) => ({ id, name, bio: null, role: "member", status: "active", avatarUrl: `/users/${id}/avatar` }));
  const newDirect = () => screen.queryByRole("dialog", { name: "New direct message" });
  const dms = () => within(screen.getByRole("navigation", { name: "Workspace", hidden: true })).getByRole("link", { name: "DMs", hidden: true });
  /** The DMs page's button that starts a new DM. */
  const compose = () => screen.getByRole("link", { name: "New direct message" });
  /** Opens New direct message from the DMs page, which the rail's DMs goes to. */
  async function openNewDirect(user: ReturnType<typeof userEvent.setup>) {
    if (!screen.queryByRole("link", { name: "New direct message" })) await user.click(dms());
    await user.click(compose());
  }

  beforeEach(() => serve({ "GET /api/users": () => Response.json({ users: people }), "POST /api/directs": () => Response.json({ room: withGrace }, { status: 201 }) }));

  it("opens over the DMs page from its New direct message, which the rail's DMs goes to, and closes back on the link", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(dms());
    expect(location.pathname).toBe("/dms");
    const link = compose();
    await user.click(link);
    expect(newDirect()).toBeInTheDocument();
    expect(location.pathname).toBe("/dms");
    expect(await screen.findByRole("option", { name: "Grace" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(newDirect()).not.toBeInTheDocument());
    expect(link).toHaveFocus();

    await user.click(link);
    expect(newDirect()).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(link).toHaveFocus());
  });

  it("opens over the last room visited at its address, which leaves no entry in the history", async () => {
    const { user } = showWorkspace("/rooms/directs/new");
    const length = history.length;
    expect(newDirect()).toBeInTheDocument();
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
    expect(screen.getByRole("heading", { level: 1, hidden: true })).toHaveTextContent("general");
    expect(history.length).toBe(length);
    expect(await screen.findByRole("option", { name: "Grace" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(newDirect()).not.toBeInTheDocument());
    expect(location.pathname).toBe("/rooms/general");
  });

  it("closes the drawer as it opens on a phone, and gives focus to the drawer's toggle once it closes", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])), "GET /api/users": () => Response.json({ users: people }) });
    const { user } = showWorkspace("/rooms/d1");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(within(screen.getByRole("dialog", { name: "Conversations" })).getByRole("link", { name: "New direct message" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument());
    expect(screen.getByRole("combobox", { name: "Search people" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(newDirect()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open conversations" })).toHaveFocus();
  });

  it("starts a DM with the people picked and opens it, listed in the sidebar, for its composer to take focus", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await openNewDirect(user);
    await user.click(await screen.findByRole("option", { name: "Grace" }));
    await user.click(screen.getByRole("button", { name: "Start conversation" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Direct message with Grace" })).toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/d1");
    expect(newDirect()).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/directs", expect.objectContaining({ method: "POST", body: JSON.stringify({ userIds: ["u2"] }) }));
    expect(within(screen.getByRole("region", { name: "Direct messages" })).getByRole("link", { name: "Direct message with Grace" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveFocus();
  });

  it("gives focus to the composer of the DM shown when that's the one started, which stays as it is", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])),
      "GET /api/users": () => Response.json({ users: people }),
      "POST /api/directs": () => Response.json({ room: withGrace }, { status: 201 }),
    });
    const { user } = showWorkspace("/rooms/d1");
    const composer = await screen.findByRole("textbox", { name: "Write a message" });
    await openNewDirect(user);
    await user.click(await screen.findByRole("option", { name: "Grace" }));
    await user.click(screen.getByRole("button", { name: "Start conversation" }));
    await waitFor(() => expect(newDirect()).not.toBeInTheDocument());
    expect(location.pathname).toBe("/rooms/d1");
    expect(screen.getByRole("textbox", { name: "Write a message" })).toBe(composer);
    await waitFor(() => expect(composer).toHaveFocus());
  });
});

describe("Suggested people", () => {
  const grace = withGrace.members[1]!;
  const suggestion = () => within(screen.getByRole("region", { name: "Direct messages" })).queryByRole("button", { name: "Start a direct message with Grace" });

  it("starts a DM with someone the DMs page suggests and opens it, listed in the suggestion's place, for its composer to take focus", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({
      "GET /api/sidebar": () => Response.json({ ...roomList(rooms), suggestions: [grace] }),
      "POST /api/directs": () => Response.json({ room: withGrace }, { status: 201 }),
    });
    const { user } = showWorkspace("/dms");
    await user.click(await screen.findByRole("button", { name: "Start a direct message with Grace" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Direct message with Grace" })).toBeInTheDocument();
    expect(location.pathname).toBe("/dms/d1");
    expect(fetch).toHaveBeenCalledWith("/api/directs", expect.objectContaining({ method: "POST", body: JSON.stringify({ userIds: [grace.id] }) }));
    expect(within(screen.getByRole("region", { name: "Direct messages" })).getByRole("link", { name: "Direct message with Grace" })).toHaveAttribute("aria-current", "page");
    expect(suggestion()).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveFocus();
  });

  it("stays on a page the person goes to while the DM starts, listing the DM", async () => {
    let answer = (_: Response) => {};
    serve({
      "GET /api/sidebar": () => Response.json({ ...roomList(rooms), suggestions: [grace] }),
      "POST /api/directs": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const { user } = showWorkspace("/dms");
    await user.click(await screen.findByRole("button", { name: "Start a direct message with Grace" }));
    await user.click(screen.getByRole("link", { name: "Home" }));
    expect(await roomHeading()).toHaveTextContent("general");

    await act(async () => answer(Response.json({ room: withGrace }, { status: 201 })));
    expect(location.pathname).toBe("/rooms/general");
    act(() => navigate("/dms"));
    expect(within(screen.getByRole("region", { name: "Direct messages" })).getByRole("link", { name: "Direct message with Grace" })).not.toHaveAttribute("aria-current");
    expect(suggestion()).not.toBeInTheDocument();
  });

  it("says why a DM didn't start, keeping the page and the suggestion", async () => {
    serve({
      "GET /api/sidebar": () => Response.json({ ...roomList(rooms), suggestions: [grace] }),
      "POST /api/directs": () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const { user } = showWorkspace("/dms");
    await user.click(await screen.findByRole("button", { name: "Start a direct message with Grace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");
    expect(location.pathname).toBe("/dms");
    expect(suggestion()).toBeInTheDocument();
    expect(suggestion()).not.toHaveAttribute("aria-disabled");
  });
});

describe("Remove someone from the workspace", () => {
  const grace: DirectoryUser = { ...withGrace.members[1]!, bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" };
  const suggestion = () => within(screen.getByRole("region", { name: "Direct messages" })).queryByRole("button", { name: "Start a direct message with Grace" });

  it("suggests nobody the workspace socket says has been removed since the sidebar loaded", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({
      "GET /api/sidebar": () => Response.json({ ...roomList(rooms), suggestions: [withGrace.members[1]] }),
      "GET /api/users": () => Response.json({ users: [grace] }),
    });
    showWorkspace("/dms");
    expect(await screen.findByRole("button", { name: "Start a direct message with Grace" })).toBeInTheDocument();
    await workspaceSends({ type: "user.updated", user: { ...grace, status: "deactivated" } });
    expect(suggestion()).not.toBeInTheDocument();
  });
});

describe("Rename the workspace", () => {
  it("passes on the workspace's name as its settings load it, which another administrator may have changed", async () => {
    serve({ "GET /api/account": () => Response.json({ ...workspaceSettings, account: { name: "Difference Engines" } }) });
    const { onAccountChanged } = showWorkspace("/account/edit");
    await waitFor(() => expect(onAccountChanged).toHaveBeenCalledExactlyOnceWith({ name: "Difference Engines" }));
  });
});

describe("Saved notices", () => {
  it("alerts with what the server said when something fails", async () => {
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }),
      "POST /api/rooms": () => Response.json({ error: "Name must be 1 to 100 characters" }, { status: 422 }),
    });
    const { user } = showWorkspace("/rooms/opens/new");
    await user.click(await screen.findByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Name must be 1 to 100 characters");
  });

  it("says when Ember can't be reached", async () => {
    serve({ "GET /api/rooms/new": () => Promise.reject(new TypeError("Failed to fetch")) });
    showWorkspace("/rooms/closeds/new");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember. Check your connection and try again.");
  });

  it("shows the same alert again when it comes again", async () => {
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }),
      "POST /api/rooms": () => Response.json({ error: "Name must be 1 to 100 characters" }, { status: 422 }),
    });
    const { user } = showWorkspace("/rooms/opens/new");
    const save = await screen.findByRole("button", { name: "Save" });
    await user.click(save);
    const first = await screen.findByRole("alert");
    await waitFor(() => expect(save).toBeEnabled());
    await user.click(save);
    await waitFor(() => expect(screen.getByRole("alert")).not.toBe(first));
  });
});

describe("Rail", () => {
  it("titles the logo with the workspace's name", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });

  it("marks Home on a room's page, and Workspace on community settings' pages, a room's settings among them", async () => {
    serve({ "GET /api/rooms/general/settings": () => Response.json(generalSettings) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    expect(railCurrent()).toEqual(["Home"]);
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(railCurrent()).toEqual(["Workspace"]);
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(railCurrent()).toEqual(["Home"]);
    await user.click(await screen.findByRole("link", { name: "Settings for this room" }));
    expect(railCurrent()).toEqual(["Workspace"]);
  });
});

describe("New releases", () => {
  const NOTES = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare/releases/tag/v0.2.0";
  const asAdministrator = { ...ada, administrator: true };
  /** How many times the release check was asked for, and afresh, as opening Admin asks for it. */
  const releaseChecks = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/account/release").length;
  const afreshChecks = () => vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input) === "/api/account/release_checks" && init?.method === "POST").length;
  // Unmounted while what it calls on the way out is still stubbed.
  afterEach(cleanup);

  /** The browser's idle callbacks, which run when a test says. */
  function idleCallbacks() {
    const idle: Array<() => void> = [];
    vi.stubGlobal("requestIdleCallback", (run: () => void) => idle.push(run));
    vi.stubGlobal("cancelIdleCallback", () => {});
    return idle;
  }

  it("asks, for an administrator, whether a newer release is out once the rooms have loaded and the browser is idle, marking Admin while one is", async () => {
    const idle = idleCallbacks();
    serve({
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
      "GET /api/account/release": () => Response.json({ release: "0.1", beta: false, newest: { release: "0.2", version: "0.2.0", notes: NOTES, newer: true }, newestBeta: null, copy: null }),
    });
    const { user } = showWorkspace("/rooms/random", asAdministrator);
    expect(await roomHeading()).toHaveTextContent("random");
    // With the pages few visits need.
    await vi.waitFor(() => expect(idle).toHaveLength(2));
    expect(releaseChecks()).toBe(0);
    act(() => idle.forEach((run) => run()));
    const admin = screen.getByRole("link", { name: "Admin" });
    await waitFor(() => expect(admin).toHaveAccessibleDescription("Ember 0.2 is available"));

    // General says so too, as the release check answered, before opening Admin has it asked afresh.
    await user.click(admin);
    expect(await screen.findByRole("heading", { level: 2, name: "Ember 0.2 is available" })).toBeInTheDocument();
    expect([releaseChecks(), afreshChecks()]).toEqual([1, 0]);
  });

  it("asks afresh each time an administrator opens Admin, once the browser is idle, but not for going on within it, or leaving", async () => {
    const idle = idleCallbacks();
    let newest = "0.2";
    const answer = () => Response.json({ release: "0.1", beta: false, newest: { release: newest, version: `${newest}.0`, notes: NOTES, newer: true }, newestBeta: null, copy: null });
    serve({
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
      "GET /api/account/release": answer,
      "POST /api/account/release_checks": answer,
    });
    const { user } = showWorkspace("/rooms/random", asAdministrator);
    await roomHeading();
    await vi.waitFor(() => expect(idle).toHaveLength(2));
    act(() => idle.splice(0).forEach((run) => run()));
    const admin = screen.getByRole("link", { name: "Admin" });
    await waitFor(() => expect(admin).toHaveAccessibleDescription("Ember 0.2 is available"));

    // GitHub has published another since, which General and the rail say once the check made afresh answers.
    newest = "0.3";
    await user.click(admin);
    expect(await screen.findByRole("heading", { level: 2, name: "Ember 0.2 is available" })).toBeInTheDocument();
    await vi.waitFor(() => expect(idle).toHaveLength(1));
    expect(afreshChecks()).toBe(0);
    act(() => idle.splice(0).forEach((run) => run()));
    expect(await screen.findByRole("heading", { level: 2, name: "Ember 0.3 is available" })).toBeInTheDocument();
    expect(admin).toHaveAccessibleDescription("Ember 0.3 is available");
    expect([releaseChecks(), afreshChecks()]).toEqual([1, 1]);

    // Going on to Membership, then home, asks nothing, but opening Admin again asks afresh again.
    await user.click(screen.getByRole("link", { name: "Membership" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Membership" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(railCurrent()).toEqual(["Home"]));
    expect(idle).toEqual([]);

    await user.click(admin);
    await communitySettings();
    await vi.waitFor(() => expect(idle).toHaveLength(1));
    act(() => idle.splice(0).forEach((run) => run()));
    await waitFor(() => expect(afreshChecks()).toBe(2));
    expect(releaseChecks()).toBe(1);
  });

  it("leaves Admin unmarked while this is the newest release, or GitHub didn't say, as General says", async () => {
    for (const [newest, says] of [
      [{ release: "0.1", version: "0.1.0", notes: NOTES, newer: false }, "This is the newest release."],
      [null, "GitHub didn't say whether a newer release is out."],
    ] as const) {
      const idle = idleCallbacks();
      // Asked afresh alone, as the page opens in Admin.
      serve({
        "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
        "POST /api/account/release_checks": () => Response.json({ release: "0.1", beta: false, newest, newestBeta: null, copy: null }),
      });
      const { unmount } = showWorkspace("/account/edit", asAdministrator);
      await communitySettings();
      await vi.waitFor(() => expect(idle).toHaveLength(2));
      act(() => idle.forEach((run) => run()));
      expect(await screen.findByRole("region", { name: "Ember 0.1" })).toHaveTextContent(says);
      expect(screen.getByRole("link", { name: "Admin" })).not.toHaveAccessibleDescription();
      expect([releaseChecks(), afreshChecks()]).toEqual([0, 1]);
      unmount();
      vi.mocked(fetch).mockClear();
    }
  });

  it("marks Admin for the beta after a beta's own, which Update Ember brings, but not for a beta a release could try", async () => {
    const betaNotes = "https://github.com/NYLLON-SOFTWARE/ember-cloudflare/releases/tag/v0.2.0-beta.2";
    const newestBeta = { release: "0.2 beta 2", version: "0.2.0-beta.2", notes: betaNotes, newer: true };
    for (const [check, card, mark] of [
      [{ release: "0.2 beta 1", beta: true, newest: { release: "0.1", version: "0.1.0", notes: NOTES, newer: false }, newestBeta, copy: null }, "Ember 0.2 beta 2 is available", "Ember 0.2 beta 2 is available"],
      [{ release: "0.1", beta: false, newest: { release: "0.1", version: "0.1.0", notes: NOTES, newer: false }, newestBeta, copy: null }, "Ember 0.1", null],
    ] as const) {
      const idle = idleCallbacks();
      serve({
        "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
        "POST /api/account/release_checks": () => Response.json(check),
      });
      const { unmount } = showWorkspace("/account/edit", asAdministrator);
      await communitySettings();
      await vi.waitFor(() => expect(idle).toHaveLength(2));
      act(() => idle.forEach((run) => run()));
      expect(await screen.findByRole("region", { name: card })).toBeInTheDocument();
      const admin = screen.getByRole("link", { name: "Admin" });
      if (mark) expect(admin).toHaveAccessibleDescription(mark);
      else expect(admin).not.toHaveAccessibleDescription();
      unmount();
      vi.mocked(fetch).mockClear();
    }
  });

  it("asks afresh at once for General's Check for updates, marking Admin once the Worker hears of a newer release", async () => {
    const idle = idleCallbacks();
    let newest = { release: "0.1", version: "0.1.0", notes: NOTES, newer: false };
    serve({
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
      "POST /api/account/release_checks": () => Response.json({ release: "0.1", beta: false, newest, checkedAt: new Date().toISOString(), newestBeta: null, copy: null }),
    });
    const { user } = showWorkspace("/account/edit", asAdministrator);
    await communitySettings();
    await vi.waitFor(() => expect(idle).toHaveLength(2));
    act(() => idle.splice(0).forEach((run) => run()));
    const card = await screen.findByRole("region", { name: "Ember 0.1" });
    const admin = screen.getByRole("link", { name: "Admin" });
    expect(admin).not.toHaveAccessibleDescription();

    // GitHub has published 0.2 since, which Check for updates hears of without waiting for the browser to be idle.
    newest = { release: "0.2", version: "0.2.0", notes: NOTES, newer: true };
    await user.click(within(card).getByRole("button", { name: "Check for updates" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Ember 0.2 is available" })).toBeInTheDocument();
    expect(admin).toHaveAccessibleDescription("Ember 0.2 is available");
    expect(idle).toEqual([]);
    expect([releaseChecks(), afreshChecks()]).toEqual([0, 2]);
  });

  it("asks nothing for anyone else, even as they open Workspace", async () => {
    const idle = idleCallbacks();
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    await vi.waitFor(() => expect(idle).toHaveLength(1));
    act(() => idle.splice(0).forEach((run) => run()));
    await import("./pages");
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    await communitySettings();
    expect(idle).toEqual([]);
    expect([releaseChecks(), afreshChecks()]).toEqual([0, 0]);
  });
});

describe("Search box", () => {
  /** What a search answers when it finds nothing. */
  const nothing = { search: null, matches: [], next: null, rooms: [], recent: [] };
  const searchBox = () => screen.queryByRole("dialog", { name: "Search" });
  const searchField = () => screen.getByRole("combobox", { name: "Search" });
  /** What the search box's tokens say. */
  const boxTokens = () =>
    within(searchBox()!)
      .queryAllByRole("button", { name: /^Remove / })
      .map((button) => button.getAttribute("aria-label")!.slice("Remove ".length));

  beforeEach(() =>
    serve({
      "GET /api/searches?q=": () => Response.json(nothing),
      "GET /api/searches?q=eel&has=link": () => Response.json({ ...nothing, search: { q: "eel", hasLink: true } }),
      "POST /api/searches": () => Response.json({ ...nothing, search: { q: "eel", in: "random" } }),
    }),
  );

  it("opens over the room from the rail, for everything, and from the room's header, in the room, giving focus back to the link as it closes", async () => {
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    const rail = screen.getByRole("link", { name: "Search" });
    await user.click(rail);
    expect(searchField()).toHaveFocus();
    expect(boxTokens()).toEqual([]);
    expect(location.pathname).toBe("/rooms/random");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(rail).toHaveFocus();

    const header = screen.getByRole("link", { name: "Search messages" });
    await user.click(header);
    expect(boxTokens()).toEqual(["in:random"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(header).toHaveFocus();
  });

  it("closes the drawer as it opens on a phone, and gives focus to the drawer's toggle once it closes", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(within(screen.getByRole("dialog", { name: "Conversations" })).getByRole("link", { name: "Search" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Conversations" })).not.toBeInTheDocument());
    expect(searchField()).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open conversations" })).toHaveFocus();
  });

  it("opens on Ctrl+F in the room shown, and with the search the results page shows, leaving the key to the browser in a dialog", async () => {
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    await user.keyboard("{Control>}f{/Control}");
    expect(boxTokens()).toEqual(["in:random"]);
    expect(searchField()).toHaveFocus();
    // Pressed again, it finds in the page.
    expect(fireEvent.keyDown(searchField(), { key: "f", ctrlKey: true })).toBe(true);
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());

    act(() => navigate("/searches?q=eel&has=link"));
    expect(await screen.findByRole("heading", { name: "No messages found" })).toBeVisible();
    await user.keyboard("{Control>}f{/Control}");
    expect(searchField()).toHaveValue("eel");
    expect(boxTokens()).toEqual(["Has a link"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "DMs" }));
    await user.click(screen.getByRole("link", { name: "New direct message" }));
    expect(fireEvent.keyDown(screen.getByRole("combobox", { name: "Search people" }), { key: "f", ctrlKey: true })).toBe(true);
    expect(searchBox()).not.toBeInTheDocument();
  });

  it("opens on Ctrl+F in the room the address names before the sidebar has listed it", async () => {
    let answer = (_: Response) => {};
    serve({
      "GET /api/searches?q=": () => Response.json(nothing),
      "GET /api/sidebar": () => new Promise((resolve) => (answer = resolve)),
    });
    const { user } = showWorkspace("/rooms/random");
    await waitFor(() => expect(roomListRequests()).toBe(1));
    await user.keyboard("{Control>}f{/Control}");
    expect(boxTokens()).toEqual(["in:an unknown room"]);
    await act(async () => answer(Response.json(roomList(rooms))));
    expect(boxTokens()).toEqual(["in:random"]);
  });

  it("goes to what a search finds, marking Search, with Exit back to the room visited last", async () => {
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Search messages" }));
    await user.keyboard("eel{Enter}");
    expect(await screen.findByRole("heading", { name: "No messages found" })).toHaveFocus();
    expect(location.pathname + location.search).toBe("/searches?q=eel&in=random");
    expect(searchBox()).not.toBeInTheDocument();
    expect(railCurrent()).toEqual(["Search"]);
    expect(document.title).toBe("Search");
    expect(within(screen.getByRole("group", { name: "Search filters" })).getByRole("button", { name: "Remove in:random" })).toBeInTheDocument();

    // The top bar's search opens the box with it, to change it.
    await user.click(screen.getByRole("button", { name: "Change search: in:random eel" }));
    expect(searchField()).toHaveValue("eel");
    expect(boxTokens()).toEqual(["in:random"]);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(searchBox()).not.toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "Exit search" }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(railCurrent()).toEqual(["Home"]);
  });
});

describe("Edit your profile", () => {
  it("shows your profile from the rail's avatar, marking it, with Go Back to the page it was opened from", async () => {
    serve({ "GET /api/users/me/profile": () => Response.json({ profile: { name: "Ada", emailAddress: "ada@example.com", bio: null } }) });
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Your profile" }));
    expect(screen.getByRole("heading", { level: 1, name: "Your profile" })).toBeInTheDocument();
    expect(location.pathname).toBe("/users/me/profile");
    expect(railCurrent()).toEqual(["Your profile"]);
    await waitFor(() => expect(screen.getByLabelText("Email address")).toHaveValue("ada@example.com"));

    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
  });

  it("logs out from your profile", async () => {
    serve({ "GET /api/users/me/profile": () => Response.json({ profile: { name: "Ada", emailAddress: "ada@example.com", bio: null } }) });
    const { onSignOut, user } = showWorkspace("/users/me/profile");
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});

describe("Connect Memberful", () => {
  const address = () => `${location.pathname}${location.search}${location.hash}`;

  it("flashes that your Memberful account is connected, once, taking it out of the address", async () => {
    const memberful = { membersOnly: true, connected: { name: "Ada Lovelace", emailAddress: "ada@example.com" } };
    serve({ "GET /api/users/me/profile": () => Response.json({ profile: { name: "Ada", emailAddress: "ada@example.com", bio: null, membershipNeeded: true, memberful } }) });
    const { unmount } = showWorkspace("/users/me/profile?memberful=connected#top");
    expect(await screen.findByRole("alert")).toHaveTextContent("Your Memberful account is connected.");
    expect(address()).toBe("/users/me/profile#top");

    unmount();
    showWorkspace(address());
    expect(await screen.findByRole("region", { name: "Memberful" })).toHaveTextContent("Connected to Memberful as Ada Lovelace (ada@example.com), so you sign in with it.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flashes what went wrong, on whatever page connecting it was started from", async () => {
    showWorkspace("/rooms/random?memberful=claimed");
    expect(await screen.findByRole("alert")).toHaveTextContent("That Memberful account is connected to someone else here.");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(address()).toBe("/rooms/random");
  });
});

describe("Someone's profile page", () => {
  const grace: DirectoryUser = { ...withGrace.members[1]!, bio: "Wrote the first compiler", role: "member", status: "active", avatarUrl: "/users/t2/avatar?v=1" };

  it("shows someone's page at their address, marking nothing on the rail, and starts a DM with them from it", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({
      "GET /api/users/u2": () => Response.json({ person: grace }),
      "POST /api/directs": () => Response.json({ room: withGrace }, { status: 201 }),
    });
    const { user } = showWorkspace("/users/u2");
    expect(await screen.findByRole("heading", { level: 1, name: "Grace" })).toBeInTheDocument();
    expect(railCurrent()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Message" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Direct message with Grace" })).toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/d1");
    expect(fetch).toHaveBeenCalledWith("/api/directs", expect.objectContaining({ method: "POST", body: JSON.stringify({ userIds: [grace.id] }) }));
  });

  it("loads the page again when nobody has the id, for the Worker to answer Campfire's 404 page", async () => {
    vi.mocked(loadPage).mockClear();
    serve({ "GET /api/users/nobody": () => Response.json({ error: "Not found" }, { status: 404 }) });
    showWorkspace("/users/nobody");
    await waitFor(() => expect(loadPage).toHaveBeenCalledExactlyOnceWith("/users/nobody"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Activity", () => {
  const item = (id: number, fields: Partial<ActivityItem> = {}): ActivityItem => ({
    id,
    kind: "mention",
    roomId: "random",
    messageId: `m${id}`,
    parentId: null,
    actorId: "u2",
    preview: `Look at this ${id}`,
    content: null,
    at: NOON,
    read: false,
    ...fields,
  });
  const activityLink = () => within(screen.getByRole("navigation", { name: "Workspace" })).getByRole("link", { name: "Activity" });
  const feed = () => screen.getByRole("list", { name: "Activity items" });
  const grace: DirectoryUser = { id: "u2", name: "Grace", bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" };
  const serveActivity = (items: ActivityItem[], responses: Parameters<typeof serve>[0] = {}) =>
    serve({
      ...responses,
      "GET /api/users": () => Response.json({ users: [grace] }),
      "GET /api/activity": () => Response.json({ items, unread: items.filter((i) => !i.read).length, more: false }),
      "POST /api/activity/marks": () => new Response(null, { status: 204 }),
    });

  it("shows Activity at its address, in the conversations' place, marking it on the rail", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(2), item(1, { kind: "direct", roomId: withGrace.id, read: true })], { "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])) });
    showWorkspace("/activity");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    await waitFor(() => expect(within(feed()).getAllByRole("button", { name: /Look at this/ })).toHaveLength(2));
    // Each says the conversation it's from, but a DM with its author alone, which needs no naming again.
    expect(within(feed()).getByRole("button", { name: /Look at this 2, Mention in #random$/ })).toHaveTextContent(/#random$/);
    expect(within(feed()).getByRole("button", { name: /Look at this 1, Direct message in Grace$/ })).toHaveTextContent(/^Look at this 1$/);
    expect(screen.queryByRole("complementary", { name: "Conversations" })).not.toBeInTheDocument();
    // Its pill counts the unread item, which the description says.
    expect(railCurrent()).toEqual(["Activity1"]);
    expect(activityLink()).toHaveAccessibleDescription("1 unread");
  });

  it("counts unread items on the rail as the workspace socket adds and marks them, on any page", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([]);
    showWorkspace("/rooms/general");
    await roomHeading();
    await workspaceSends({ type: "activity.added", items: [item(1), item(2)] });
    expect(activityLink()).toHaveAccessibleDescription("2 unread");
    act(() => WorkspaceSocket.last!.onmessage?.({ data: JSON.stringify({ type: "activity.marked", ids: [1], read: true }) }));
    expect(activityLink()).toHaveAccessibleDescription("1 unread");
    act(() => WorkspaceSocket.last!.onmessage?.({ data: JSON.stringify({ type: "activity.marked", ids: null, read: true }) }));
    expect(activityLink()).not.toHaveAttribute("aria-description");
  });

  it("filters by tab, unread and search, and marks items read and unread", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(3, { kind: "thread", preview: "a reply", parentId: "m0" }), item(2, { read: true }), item(1, { kind: "direct", roomId: withGrace.id, preview: "lunch?" })]);
    const { user } = showWorkspace("/activity");
    const previews = () => within(feed()).queryAllByRole("button", { name: /^Grace/ }).map((row) => row.textContent);
    await waitFor(() => expect(previews()).toHaveLength(3));

    await user.click(screen.getByRole("button", { name: "Threads" }));
    expect(previews()).toEqual([expect.stringContaining("a reply")]);
    await user.click(screen.getByRole("button", { name: "All" }));
    const unreads = screen.getByRole("button", { name: "Unreads", pressed: false });
    await user.click(unreads);
    expect(unreads).toHaveAttribute("aria-pressed", "true");
    expect(previews()).toHaveLength(2);
    await user.click(unreads);
    await user.click(screen.getByRole("button", { name: "Search activity" }));
    await user.type(screen.getByRole("searchbox", { name: "Search activity" }), "lunch");
    expect(previews()).toEqual([expect.stringContaining("lunch?")]);

    await user.click(within(feed()).getByRole("button", { name: /^Mark read: Grace, / }));
    expect(fetch).toHaveBeenCalledWith("/api/activity/marks", expect.objectContaining({ method: "POST", body: JSON.stringify({ ids: [1], read: true }) }));
    expect(within(feed()).getByRole("button", { name: /^Mark unread: Grace, / })).toBeInTheDocument();
  });

  it("shows an unread item by its row alone, marking it with U or its menu, and everything from ⋯", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(2), item(1, { read: true })]);
    const { user } = showWorkspace("/activity");
    const row = async (preview: string) => (await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: new RegExp(preview) })).closest("li")!;
    const unread = await row("Look at this 2");
    expect(unread).toHaveClass("bg-activity-unread");
    expect(await row("Look at this 1")).not.toHaveClass("bg-activity-unread");
    expect(within(unread).getByRole("button", { name: /Look at this 2/ })).toHaveAccessibleName(/^Grace, unread: /);
    // No dots, and the tabs have none either: the rail's count says there's something unread.
    expect(within(feed()).queryByLabelText("Unread")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveTextContent(/^All$/);

    within(unread).getByRole("button", { name: /Look at this 2/ }).focus();
    await user.keyboard("u");
    expect(fetch).toHaveBeenCalledWith("/api/activity/marks", expect.objectContaining({ body: JSON.stringify({ ids: [2], read: true }) }));
    expect(unread).not.toHaveClass("bg-activity-unread");

    fireEvent.contextMenu(unread, { clientX: 40, clientY: 20 });
    await user.click(await screen.findByRole("menuitem", { name: /^Mark unread/ }));
    expect(fetch).toHaveBeenCalledWith("/api/activity/marks", expect.objectContaining({ body: JSON.stringify({ ids: [2], read: false }) }));
    expect(unread).toHaveClass("bg-activity-unread");

    await user.click(screen.getByRole("button", { name: "More activity actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark all read" }));
    expect(fetch).toHaveBeenCalledWith("/api/activity/marks", expect.objectContaining({ body: JSON.stringify({ all: true, read: true }) }));
  });

  it("says in one line why the feed's empty", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(1, { read: true })]);
    const { user } = showWorkspace("/activity");
    await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: /Look at this 1/ });
    await user.click(screen.getByRole("button", { name: "Unreads" }));
    expect(within(feed()).getByRole("listitem")).toHaveTextContent(/^You’re all caught up\.$/);
    // On any tab.
    await user.click(screen.getByRole("button", { name: "Threads" }));
    expect(within(feed()).getByRole("listitem")).toHaveTextContent(/^You’re all caught up\.$/);
    await user.click(screen.getByRole("button", { name: "Search activity" }));
    await user.type(screen.getByRole("searchbox", { name: "Search activity" }), "nothing like it");
    expect(within(feed()).getByRole("listitem")).toHaveTextContent(/^Nothing matches\.$/);
  });

  it("opens an item's room beside the feed at its message, reading the item", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(1)]);
    const { user } = showWorkspace("/activity");
    await user.click(await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: /Look at this 1/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "random" })).toBeInTheDocument();
    // The address says what's open, so a reload keeps it, and Back closes it.
    expect(location.pathname).toBe("/activity/rooms/random/@m1");
    expect(fetch).toHaveBeenCalledWith("/api/activity/marks", expect.objectContaining({ body: JSON.stringify({ ids: [1], read: true }) }));
    expect(screen.getAllByRole("separator", { name: "Resize activity" })).toHaveLength(1);
    expect(within(feed()).getAllByRole("listitem").find((row) => row.getAttribute("aria-current") === "true")).toHaveTextContent("Look at this 1");
    act(() => history.back());
    await waitFor(() => expect(location.pathname).toBe("/activity"));
    expect(screen.queryByRole("heading", { level: 1, name: "random" })).not.toBeInTheDocument();
  });

  it("closes what it opened by going back, so Back never opens it again", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(3, { kind: "thread", parentId: "m0", preview: "a reply" })]);
    const { user } = showWorkspace("/activity");
    await user.click(await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: /a reply/ }));
    expect(location.pathname).toBe("/activity/rooms/random/threads/m0/@m3");
    await user.click(await screen.findByRole("button", { name: "Close thread" }));
    // Opened from the feed, the thread closes into the conversation in its place, which Back closes too.
    await waitFor(() => expect(location.pathname).toBe("/activity/rooms/random"));
    act(() => history.back());
    await waitFor(() => expect(location.pathname).toBe("/activity"));
    expect(screen.queryByRole("heading", { level: 1, name: "random" })).not.toBeInTheDocument();
  });

  it("says a conversation its address names can't be opened, for a room you aren't in", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([]);
    showWorkspace("/activity/rooms/elsewhere/@m1");
    expect(await screen.findByText("You can’t open this conversation.")).toBeInTheDocument();
  });

  it("opens a profile beside the feed with nothing open, with no empty pane between", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(1)], { "GET /api/users/u2": () => Response.json({ person: grace }) });
    const { user } = showWorkspace("/activity");
    await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: /Look at this 1/ });
    await user.click(within(feed()).getAllByRole("link", { name: "Grace" })[1]!);
    expect(await screen.findByRole("complementary", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getAllByRole("separator", { name: /^Resize/ }).map((separator) => separator.getAttribute("aria-label"))).toEqual(["Resize profile"]);
  });

  it("opens the conversation and thread its address names beside the feed, closing the thread back to the conversation", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(3, { kind: "thread", parentId: "m0", preview: "a reply" })]);
    const { user } = showWorkspace("/activity/rooms/random/threads/m0/@m3");
    expect(await screen.findByRole("heading", { level: 1, name: "random" })).toBeInTheDocument();
    expect(await screen.findByRole("separator", { name: "Resize thread" })).toBeInTheDocument();
    await waitFor(() => expect(within(feed()).getAllByRole("listitem").find((row) => row.getAttribute("aria-current") === "true")).toHaveTextContent("a reply"));
    await user.click(await screen.findByRole("button", { name: "Close thread" }));
    expect(location.pathname).toBe("/activity/rooms/random");
    expect(screen.queryByRole("separator", { name: "Resize thread" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "random" })).toBeInTheDocument();
  });

  it("opens an item's author's profile beside the feed from their name or avatar, without opening the item", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveActivity([item(1)], { "GET /api/users/u2": () => Response.json({ person: { ...grace, bio: "Wrote the first compiler" } }) });
    const { user } = showWorkspace("/activity");
    await within(await screen.findByRole("list", { name: "Activity items" })).findByRole("button", { name: /Look at this 1/ });
    const [avatar, name] = within(feed()).getAllByRole("link", { name: "Grace" });
    expect(avatar).toHaveAttribute("href", "/users/u2");
    await user.click(name!);
    const profile = screen.getByRole("complementary", { name: "Profile" });
    expect(await within(profile).findByRole("heading", { name: "Grace" })).toBeInTheDocument();
    expect(location.pathname).toBe("/activity");
    expect(fetch).not.toHaveBeenCalledWith("/api/activity/marks", expect.anything());
    await user.click(within(profile).getByRole("button", { name: "Close profile" }));
    await user.click(avatar!);
    expect(screen.getByRole("complementary", { name: "Profile" })).toBeInTheDocument();
  });
});

describe("Profile pane", () => {
  /** A link to someone's page in the room shown, as a message's avatar is. */
  const personLink = (userId: string) => {
    const link = document.createElement("a");
    link.href = `/users/${userId}`;
    link.textContent = "Grace";
    screen.getByRole("main").append(link);
    return link;
  };

  it("opens someone's profile beside the room from a link to their page, and closes it", async () => {
    serve({ "GET /api/users/u2": () => Response.json({ person: { id: "u2", name: "Grace", bio: "Wrote the first compiler", role: "member", status: "active", avatarUrl: "/users/u2/avatar", timeZone: "America/New_York" } }) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(personLink("u2"));
    const profile = screen.getByRole("complementary", { name: "Profile" });
    expect(location.pathname).toBe("/rooms/general");
    expect(await within(profile).findByRole("heading", { name: "Grace" })).toBeInTheDocument();
    expect(within(profile).getByText("Wrote the first compiler")).toBeInTheDocument();
    expect(within(profile).getByText(/local time$/)).toBeInTheDocument();
    expect(within(profile).getByRole("button", { name: "Message" })).toBeInTheDocument();
    expect(within(profile).getByRole("button", { name: "More actions" })).toBeInTheDocument();
    await user.click(within(profile).getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument());
    expect(location.pathname + location.search).toBe("/rooms/general");
  });

  it("keeps the profile open in the address, through a reload, Back closing it", async () => {
    serve({ "GET /api/users/u2": () => Response.json({ person: { id: "u2", name: "Grace", bio: null, role: "member", status: "active", avatarUrl: "/users/u2/avatar" } }) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(personLink("u2"));
    expect(location.pathname + location.search).toBe("/rooms/general?profile=u2");
    act(() => history.back());
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument());
    expect(location.search).toBe("");
    cleanup();

    showWorkspace("/rooms/general?profile=u2");
    expect(await within(await screen.findByRole("complementary", { name: "Profile" })).findByRole("heading", { name: "Grace" })).toBeInTheDocument();
    // Closed on a page it didn't open on, it goes, leaving nothing for Back to open again.
    await user.click(screen.getByRole("button", { name: "Close profile" }));
    expect(location.pathname + location.search).toBe("/rooms/general");
    expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument();
  });

  it("opens someone's profile beside the People page from their card, keeping the directory", async () => {
    const grace = { id: "u2", name: "Grace", bio: "Wrote the first compiler", role: "member", status: "active", avatarUrl: "/users/u2/avatar" };
    serve({ "GET /api/users": () => Response.json({ users: [grace] }), "GET /api/users/u2": () => Response.json({ person: grace }) });
    const { user } = showWorkspace("/people");
    const people = await screen.findByRole("list", { name: "People" });
    await user.click(await within(people).findByRole("link", { name: /Grace/ }));
    const profile = screen.getByRole("complementary", { name: "Profile" });
    expect(location.pathname + location.search).toBe("/people?profile=u2");
    expect(await within(profile).findByRole("heading", { name: "Grace" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "People" })).toBeInTheDocument();
    await user.click(within(profile).getByRole("button", { name: "Close profile" }));
    await waitFor(() => expect(location.pathname + location.search).toBe("/people"));
  });

  it("follows a link to someone's page on a page with no pane for it", async () => {
    const { user } = showWorkspace("/account/edit");
    await communitySettings();
    const link = document.createElement("a");
    link.href = "/users/u2";
    link.textContent = "Grace";
    document.body.querySelector("main")!.append(link);
    await user.click(link);
    expect(screen.queryByRole("complementary", { name: "Profile" })).not.toBeInTheDocument();
  });
});

describe("Conversations sidebar", () => {
  it("switches rooms from the sidebar and puts the room in the address", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    const sidebar = screen.getAllByRole("region", { name: "Rooms" })[0]!;
    await user.click(within(sidebar).getByRole("link", { name: /random/ }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("marks the room a link to one of its messages opens", async () => {
    showWorkspace("/rooms/random/@m1");
    expect(await roomHeading()).toHaveTextContent("random");
    const sidebar = screen.getAllByRole("region", { name: "Rooms" })[0]!;
    expect(within(sidebar).getByRole("link", { name: /random/ })).toHaveAttribute("aria-current", "page");
  });
});

describe("Live sidebar updates", () => {
  beforeEach(() => {
    WorkspaceSocket.last = null;
    vi.stubGlobal("WebSocket", WorkspaceSocket);
  });

  it("shows rooms as they're made and changed anywhere, the one shown included", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    await workspaceSends({ type: "room.saved", room: { id: "design", name: "Design", kind: "open", icon: null } });
    expect(sidebarRooms()).toEqual(["Design", "general", "random"]);

    await workspaceSends({ type: "room.saved", room: { ...rooms[0]!, name: "plans" } });
    expect(sidebarRooms()).toEqual(["Design", "plans", "random"]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("plans");
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #plans");
  });

  it("keeps the room shown on screen, saying it was deleted, when the workspace socket says it's gone before the room's own does", async () => {
    showWorkspace("/rooms/random");
    await roomHeading();
    await workspaceSends({ type: "room.gone", roomId: "random" });
    expect(sidebarRooms()).toEqual(["general"]);
    expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted");
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/random");
  });

  it("drops the tab from the address of a room that's gone while a tab of it is shown (E-R5-18)", async () => {
    serve({ "GET /api/rooms/random/library": () => Response.json({ files: [], links: [] }) });
    showWorkspace("/rooms/random?tab=files");
    await roomHeading();
    await screen.findByRole("tabpanel", { name: "Files & links" }, { timeout: 5000 });
    await workspaceSends({ type: "room.gone", roomId: "random" });
    expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted");
    await waitFor(() => expect(location.pathname + location.search).toBe("/rooms/random"));
  });

  it("says someone taken out of a room that's still there no longer has access to it, rather than that it was deleted", async () => {
    showWorkspace("/rooms/random");
    await roomHeading();
    await workspaceSends({ type: "room.gone", roomId: "random", lostAccess: true });
    expect(sidebarRooms()).toEqual(["general"]);
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have access to #random");
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to #general" })).toBeInTheDocument();
    // The bar above names the room still, muted.
    expect(screen.getByRole("navigation", { name: "Page" })).toHaveTextContent("#random");
  });

  it("shows a room said to be gone as it is once the workspace socket brings it back, as when someone is put back in it", async () => {
    showWorkspace("/rooms/random");
    await roomHeading();
    await workspaceSends({ type: "room.gone", roomId: "random" });
    expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted");

    await workspaceSends({ type: "room.saved", room: rooms[1]! });
    expect(sidebarRooms()).toEqual(["general", "random"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #random");
  });

  it("connects again to a room its own socket found gone once the workspace socket brings it back", async () => {
    // The room's first socket finds it gone, as when Ada has been taken out of it, and the next lets her in.
    let roomSockets = 0;
    class ReturningRoom extends WorkspaceSocket {
      onclose: ((event: { code: number }) => void) | null = null;
      constructor(url: string) {
        super(url);
        if (!url.includes("/api/rooms/random/socket")) return;
        const first = ++roomSockets === 1;
        setTimeout(() => {
          this.onopen?.();
          if (first) this.onclose?.({ code: CloseCode.NotFound });
          else this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada, messages: [], present: [ada], hasMore: false }) });
        });
      }
    }
    vi.stubGlobal("WebSocket", ReturningRoom);
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/rooms/random");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("#random was deleted"));
    // The page takes the room out of the sidebar in an effect, just after it says so.
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));

    await workspaceSends({ type: "room.saved", room: rooms[1]! });
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #random");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sidebarRooms()).toEqual(["general", "random"]);
    expect(roomSockets).toBe(2);
  });

  it("takes a room that's gone out of the sidebar, leaving the room shown as it is", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    await workspaceSends({ type: "room.gone", roomId: "random" });
    expect(sidebarRooms()).toEqual(["general"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #general");
  });
});

describe("Star rooms", () => {
  const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
  const star = () => screen.getByRole("button", { name: "Star room" });

  it("lists your starred rooms first, and stars the room shown from its header, moving it up", async () => {
    const answered = { rooms: ["random", "design"], version: 2 };
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, design], ["random"])),
      "PUT /api/rooms/design/favorite": () => Response.json({ favorites: answered }),
    });
    const { user } = showWorkspace("/rooms/design");
    expect(await roomHeading()).toHaveTextContent("Design");
    expect(sidebarRooms()).toEqual(["random★", "Design", "general"]);
    expect(star()).toHaveAttribute("aria-pressed", "false");

    await user.click(star());
    expect(star()).toHaveAttribute("aria-pressed", "true");
    expect(sidebarRooms()).toEqual(["random★", "Design★", "general"]);
  });

  it("keeps the room where it was when its star isn't saved", async () => {
    serve({ "PUT /api/rooms/random/favorite": () => Response.json({ error: "You can't star that room" }, { status: 403 }) });
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();

    await user.click(star());
    expect(star().nextElementSibling).toHaveRole("status");
    expect(star().nextElementSibling).toHaveTextContent("Couldn’t save your star. Please try again.");
    expect(star()).toHaveAttribute("aria-pressed", "false");
    expect(sidebarRooms()).toEqual(["general", "random"]);
  });
});

describe("New line over the messages that came while a room was unread", () => {
  const grace = { id: "u2", name: "Grace" };
  const said: Message = { id: "m1", clientMessageId: "m1", roomId: "random", creator: grace, body: "Morning", plainText: "Morning", mentions: [], createdAt: NOON, updatedAt: NOON, editedAt: null, boosts: [] };
  /** The workspace socket, and rooms' sockets, which welcome Ada into random with Grace's message, and into any other room with none. */
  class RandomSocket extends WorkspaceSocket {
    constructor(url: string) {
      super(url);
      if (!url.includes("/api/rooms/")) return;
      setTimeout(() => {
        this.readyState = QuietSocket.OPEN;
        this.onopen?.();
        const messages = url.includes("/api/rooms/random/") ? [said] : [];
        this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada, messages, present: [ada], hasMore: false }) });
      });
    }
  }
  const newLine = () => screen.queryByRole("separator", { name: "New messages" });

  it("draws New over the first message in a room opened while it's marked unread, but not once it's read and opened again", async () => {
    vi.stubGlobal("WebSocket", RandomSocket);
    const list = roomList(rooms);
    serve({ "GET /api/sidebar": () => Response.json({ ...list, rooms: list.rooms.map((room) => (room.id === "random" ? { ...room, unread: true, unreadSince: NOON } : room)) }) });
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(newLine()).not.toBeInTheDocument();

    act(() => navigate("/rooms/random"));
    expect(await screen.findByRole("separator", { name: "New messages" })).toBeVisible();

    // Opening it read it, as the server tells the tab.
    await workspaceSends({ type: "room.read", roomId: "random" });
    expect(newLine()).toBeVisible();
    act(() => navigate("/rooms/general"));
    await waitFor(() => expect(newLine()).not.toBeInTheDocument());
    act(() => navigate("/rooms/random"));
    expect(await screen.findByText("Morning")).toBeVisible();
    expect(newLine()).not.toBeInTheDocument();
  });
});

describe("Keyboard shortcuts", () => {
  const shortcuts = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });

  it("opens on Ctrl+/ from the composer, closes on Escape, handing focus back, and stays shut over another dialog", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    const composer = await screen.findByRole("textbox", { name: "Write a message" });
    await user.click(composer);
    expect(fireEvent.keyDown(composer, { key: "/", ctrlKey: true })).toBe(false);
    expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(shortcuts()).not.toBeInTheDocument());
    await waitFor(() => expect(composer).toHaveFocus());

    await user.click(screen.getByRole("link", { name: "DMs" }));
    await user.click(screen.getByRole("link", { name: "New direct message" }));
    expect(fireEvent.keyDown(screen.getByRole("combobox", { name: "Search people" }), { key: "/", ctrlKey: true })).toBe(true);
    expect(shortcuts()).not.toBeInTheDocument();
  });

  it("stays shut over a native modal dialog, which has no role attribute", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    showWorkspace("/rooms/general");
    await roomHeading();
    const modal = document.createElement("dialog");
    const button = document.createElement("button");
    button.textContent = "Allow";
    modal.append(button);
    document.body.append(modal);
    modal.showModal();
    try {
      expect(fireEvent.keyDown(button, { key: "/", ctrlKey: true })).toBe(true);
      expect(shortcuts()).not.toBeInTheDocument();
    } finally {
      modal.remove();
    }
  });
});

describe("Welcome card for administrators, until they dismiss it", () => {
  const invited = { ...roomList(rooms), invitation: { roomId: "general", joinCode: "aB3d-Ef5h-iJ7k" } };
  const card = () => screen.queryByRole("heading", { name: "Welcome to Ember" });
  /** Shows general with the welcome card, its dismissal answered by `answer`. */
  async function showCard(answer: () => Response) {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    serve({ "GET /api/sidebar": () => Response.json(invited), "DELETE /api/sidebar/invitation": answer });
    const shown = showWorkspace("/rooms/general");
    // The card shows once the sidebar and the room have both come, which can take a while on a busy machine.
    return { ...shown, dismiss: await screen.findByRole("button", { name: "Dismiss welcome card" }, { timeout: 10_000 }) };
  }

  it("takes the welcome card away once its × has saved that it's dismissed", async () => {
    const { dismiss, user } = await showCard(() => new Response(null, { status: 204 }));
    await user.click(dismiss);
    await waitFor(() => expect(card()).not.toBeInTheDocument());
    expect(vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input) === "/api/sidebar/invitation" && init?.method === "DELETE")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the card when the dismissal isn't saved, saying why", async () => {
    const { dismiss, user } = await showCard(() => Response.json({ error: "Workspace unavailable" }, { status: 503 }));
    await user.click(dismiss);
    expect(await screen.findByRole("alert")).toHaveTextContent("Workspace unavailable");
    expect(card()).toBeInTheDocument();
    expect(dismiss).not.toHaveAttribute("aria-disabled");
  });

  it("goes to sign in when the dismissal finds the session gone", async () => {
    const { dismiss, onSessionChanged, user } = await showCard(() => Response.json({ error: "Not signed in" }, { status: 401 }));
    await user.click(dismiss);
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("Shared room order", () => {
  /** The rooms `order` lists, top to bottom, by the names of their links to their settings. */
  const roomsIn = (order: HTMLElement) => within(order).getAllByRole("link", { name: /^Settings for / }).map((link) => link.getAttribute("aria-label")!.replace("Settings for ", ""));

  it("puts the sidebar's rooms in the order an administrator saves on workspace settings, after their stars", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    let sharedOrder: RoomId[] = ["general"];
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, design], ["random"], sharedOrder)),
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
      "PUT /api/account/room_order": () => Response.json({ sharedOrder: (sharedOrder = ["design", "general", "random"]) }),
    });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    expect(sidebarRooms()).toEqual(["random★", "general", "Design"]);
    act(() => navigate("/account/edit#channel-settings"));
    const order = await screen.findByRole("list", { name: "Room order" });
    expect(roomsIn(order)).toEqual(["general", "Design", "random"]);

    fireEvent.keyDown(within(order).getAllByRole("listitem")[1]!, { key: "ArrowUp", altKey: true });
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByText("Room order saved for everyone.")).toBeInTheDocument();
    expect(roomsIn(order)).toEqual(["Design", "general", "random"]);
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await roomHeading();
    expect(sidebarRooms()).toEqual(["random★", "Design", "general"]);
  });

  it("loads the rooms again once a save is answered, so an answer that comes after a newer order has loaded doesn't stay", async () => {
    WorkspaceSocket.last = null;
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    // So a new order loads at once, rather than at a random time up to 5 seconds later.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    let sharedOrder: RoomId[] = [];
    let answer = (_: Response) => {};
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, design], [], sharedOrder)),
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true }),
      "PUT /api/account/room_order": () => new Promise((resolve) => (answer = resolve)),
    });
    const { user } = showWorkspace("/account/edit#channel-settings");
    const order = await screen.findByRole("list", { name: "Room order" });
    await waitFor(() => expect(roomListRequests()).toBe(2));
    fireEvent.keyDown(within(order).getAllByRole("listitem")[1]!, { key: "ArrowUp", altKey: true });
    await user.click(screen.getByRole("button", { name: "Save order" }));

    // Another administrator saves after this one, and their order loads before this one's answer comes.
    sharedOrder = ["random", "general", "design"];
    act(() => WorkspaceSocket.last!.onmessage?.({ data: JSON.stringify({ type: "rooms.reordered" }) }));
    await waitFor(() => expect(roomListRequests()).toBe(3));
    await act(async () => answer(Response.json({ sharedOrder: ["general", "design", "random"] })));
    await waitFor(() => expect(roomListRequests()).toBe(4));
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await roomHeading();
    await waitFor(() => expect(sidebarRooms()).toEqual(["random", "general", "Design"]));
  });
});

describe("Stay signed in, per device", () => {
  it("goes back to sign-in when the server no longer accepts the session", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const { onSignOut, onSessionChanged } = showWorkspace();
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    // The session is already gone, so there's nothing to sign out of.
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("goes back to sign-in when asking for the list again finds the session gone", async () => {
    const answers = [Response.json(roomList(rooms)), Response.json({ error: "Not signed in" }, { status: 401 })];
    serve({ "GET /api/sidebar": () => answers.shift()! });
    const { onSessionChanged } = showWorkspace("/rooms/secret");
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([
    ["a room's settings", "/rooms/opens/general/edit", "GET /api/rooms/general/settings"],
    ["workspace settings", "/account/edit", "GET /api/account"],
  ])("goes back to sign-in when %s find the session gone", async (_, path, request) => {
    serve({ [request]: () => Response.json({ error: "Not signed in" }, { status: 401 }) });
    const { onSessionChanged } = showWorkspace(path);
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes back to sign-in when a page that was left finds the session gone", async () => {
    let answer = (_: Response) => {};
    serve({ "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }), "POST /api/rooms": () => new Promise((resolve) => (answer = resolve)) });
    const { onSessionChanged, user } = showWorkspace("/rooms/opens/new");
    await user.type(await screen.findByRole("textbox", { name: "Room name" }), "{Enter}");
    act(() => navigate("/account/edit"));
    await act(async () => answer(Response.json({ error: "Not signed in" }, { status: 401 })));
    expect(onSessionChanged).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("says nothing more once another person's workspace has taken its place", async () => {
    let answer = (_: Response) => {};
    serve({ "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }), "POST /api/rooms": () => new Promise((resolve) => (answer = resolve)) });
    const { onSessionChanged, unmount, user } = showWorkspace("/rooms/opens/new");
    await user.type(await screen.findByRole("textbox", { name: "Room name" }), "{Enter}");
    // As App replaces it when another tab signs in as someone else.
    unmount();
    await act(async () => answer(Response.json({ error: "Not signed in" }, { status: 401 })));
    expect(onSessionChanged).not.toHaveBeenCalled();
  });

  it("says nothing of the list asked again once another person's workspace has taken its place", async () => {
    let answer = (_: Response) => {};
    const answers = [() => Response.json(roomList(rooms)), () => new Promise<Response>((resolve) => (answer = resolve))];
    serve({ "GET /api/sidebar": () => answers.shift()!() });
    const { onSessionChanged, unmount } = showWorkspace("/rooms/secret");
    await waitFor(() => expect(roomListRequests()).toBe(2));
    unmount();
    await act(async () => answer(Response.json({ error: "Not signed in" }, { status: 401 })));
    expect(onSessionChanged).not.toHaveBeenCalled();
  });
});

describe("Conversations drawer on phones", () => {
  it("opens the rail and rooms in a drawer, and closes it after you pick a room", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    expect(within(drawer).getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(within(drawer).getByRole("complementary", { name: "Conversations" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("link", { name: /random/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await roomHeading()).toHaveTextContent("random");
  });

  it("names its button for what it does next, and focuses Close conversations when it opens", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    const open = screen.getByRole("button", { name: "Open conversations", expanded: false });
    await user.click(open);
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    // The header's button now closes it, and the drawer hides it from screen readers with the rest of the page.
    expect(open).toHaveAttribute("aria-label", "Close conversations");
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(drawer).not.toContainElement(open);
    await waitFor(() => expect(open).toHaveAttribute("aria-hidden", "true"));
    const close = within(drawer).getByRole("button", { name: "Close conversations" });
    expect(close).toHaveFocus();
    // Iconoir's menu and xmark.
    expect(open.querySelector("svg")).toHaveClass("iconoir-menu", "size-[22px]");
    expect(close.querySelector("svg")).toHaveClass("iconoir-xmark", "size-5");
  });

  it("puts its close button first in the conversations' tab order", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.tab();
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Threads" })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: "Your profile" })).toHaveFocus();
  });

  it("closes when a rail link shows another page", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    await user.click(within(drawer).getByRole("link", { name: "Workspace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await communitySettings()).toBeInTheDocument();
  });

  it("closes when you follow a link to the page shown", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: /general/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: "Workspace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(location.pathname).toBe("/account/edit");
  });

  it("stays open when a link to the page shown opens somewhere else", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    const openElsewhere = (name: string | RegExp, init: MouseEventInit) => {
      // Keeps jsdom, which can't open a tab, from following the link once the page has had the click.
      document.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("link", { name }), init);
    };
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) openElsewhere(/general/, init);
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) openElsewhere("Workspace", init);
    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
  });

  it("leaves Escape to the appearance menu while it's open over the drawer", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Appearance: System" }));
    expect(screen.getByRole("dialog", { name: "Appearance" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Appearance" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on Escape, giving focus back to its button", async () => {
    const { user } = showWorkspace();
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Open conversations" })).toHaveFocus());
  });
});

describe("Landmarks and names", () => {
  it("skips to the main content from the first thing Tab reaches, leaving the address as it is", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    // The room's composer takes focus as it opens. From the top of the page, Tab reaches the link first.
    (await screen.findByRole("textbox", { name: "Write a message" })).blur();
    await user.tab();
    const skip = screen.getByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("main")).toHaveFocus();
    expect(location.pathname + location.hash).toBe("/rooms/general");
    // Tab goes on from there into it.
    await user.tab();
    expect(screen.getByRole("main")).toContainElement(document.activeElement as HTMLElement);
  });

  it("names the landmarks: the rail and the header as navigation, the conversations, and the main content", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Page" })).toContainElement(screen.getByRole("heading", { level: 1 }));
    expect(screen.getByRole("complementary", { name: "Conversations" })).toContainElement(screen.getByRole("region", { name: "Rooms" }));
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });

  it("names the rail, the rooms, the Home sidebar's links, the messages and the composer", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("log", { name: "Messages in general" }));
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toBeInTheDocument();
  });

  it("gives every button and link a name, icon-only ones included", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("link")]) {
      expect(control).toHaveAccessibleName();
    }
  });
});

describe("Notification levels", () => {
  it("keeps a level another tab saves while the bell's answer is on its way", async () => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    let answer = (_: Response) => {};
    serve({
      "GET /api/sidebar": () => Response.json(roomList(rooms)),
      "PUT /api/rooms/general/involvement": () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const { user } = showWorkspace("/rooms/general");
    await user.click(await screen.findByRole("checkbox", { name: "Notifying about @ mentions" }));
    // The socket brings the level this tab saved, then the next, which another tab saved before the answer.
    await workspaceSends({ type: "room.involvement", roomId: "general", involvement: "everything" });
    await workspaceSends({ type: "room.involvement", roomId: "general", involvement: "nothing" });
    await act(async () => answer(Response.json({ involvement: "everything" })));
    expect(screen.getByRole("checkbox", { name: "Notifications are off" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("Hide a room", () => {
  it("takes the room shown out of the sidebar once its bell hides it, keeping it open, and puts it back once it's shown again", async () => {
    const listed: SidebarRoom[] = [
      { ...rooms[0]!, unread: false, involvement: "nothing" },
      { ...rooms[1]!, unread: false, involvement: "mentions" },
    ];
    const levels = ["invisible", "mentions"];
    serve({
      "GET /api/sidebar": () => Response.json(roomList(listed)),
      "PUT /api/rooms/general/involvement": () => Response.json({ involvement: levels.shift() }),
    });
    const { user } = showWorkspace("/rooms/general");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(sidebarRooms()).toEqual(["general", "random"]);

    await user.click(screen.getByRole("checkbox", { name: "Notifications are off" }));
    await waitFor(() => expect(sidebarRooms()).toEqual(["random"]));
    expect(screen.getByRole("checkbox", { name: "Notifications are off and room invisible in sidebar" })).toBeInTheDocument();
    expect(await roomHeading()).toHaveTextContent("general");

    await user.click(screen.getByRole("checkbox", { name: "Notifications are off and room invisible in sidebar" }));
    await waitFor(() => expect(sidebarRooms()).toEqual(["general", "random"]));
  });

  it("leaves the rooms you've hidden out of the app's badge", async () => {
    const listed: SidebarRoom[] = [
      { ...rooms[0]!, unread: false, involvement: "mentions" },
      { ...rooms[1]!, unread: true, involvement: "invisible" },
    ];
    serve({ "GET /api/sidebar": () => Response.json(roomList(listed)) });
    const badges = badgeTheApp();
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(sidebarRooms()).toEqual(["general"]);
    await waitFor(() => expect(badges).toEqual(["cleared"]));
  });
});

describe("Push subscriptions page", () => {
  it("shows your push subscriptions at their address, or at anyone's id in place of me, marking nothing on the rail, with Go Back to the last room visited", async () => {
    serve({ "GET /api/push-subscriptions": () => Response.json({ subscriptions: [{ id: 1, endpoint: "https://web.push.apple.com/abc", browser: "Safari", version: "18.0", platform: "iPhone" }] }) });
    const { user } = showWorkspace("/rooms/random");
    expect(await roomHeading()).toHaveTextContent("random");

    for (const path of ["/users/me/push_subscriptions", "/users/u2/push_subscriptions"]) {
      act(() => navigate(path));
      expect(await screen.findByRole("heading", { level: 1, name: "Push Notification Subscriptions" })).toBeInTheDocument();
      expect(await screen.findByText("Safari 18.0 on iPhone")).toBeInTheDocument();
      expect(document.title).toBe("Push notification subscriptions");
      expect(railCurrent()).toEqual([]);
    }
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
  });
});

describe("Chat bots page", () => {
  const bot: Bot = { id: "b1", name: "Build Bot", bio: null, role: "bot", status: "active", avatarUrl: "/users/b0t/avatar?v=1", key: "b1-Ab3dEf5hiJ7k", rooms: [] };

  it("shows the bot pages at their addresses, marking Workspace on the rail, with Go Back to the bots page, and from there to workspace settings", async () => {
    serve({
      "GET /api/account/bots": () => Response.json({ bots: [bot] }),
      "GET /api/account/bots/b1": () => Response.json({ bot: { ...bot, webhookUrl: null } }),
    });
    const { user } = showWorkspace("/account/bots");
    expect(await screen.findByRole("heading", { level: 1, name: "Chat bots" })).toBeInTheDocument();
    expect(railCurrent()).toEqual(["Workspace"]);

    await user.click(await screen.findByRole("link", { name: "Edit Build Bot" }));
    expect(await screen.findByRole("textbox", { name: "Bot name" })).toHaveValue("Build Bot");
    expect(document.title).toBe("Edit bot");
    expect(railCurrent()).toEqual(["Workspace"]);
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Chat bots" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await communitySettings()).toBeInTheDocument();
  });

  it("loads a bot's settings again when no active bot has the id, for the Worker to answer Campfire's 404 page", async () => {
    vi.mocked(loadPage).mockClear();
    serve({ "GET /api/account/bots/nobody": () => Response.json({ error: "Not found" }, { status: 404 }) });
    showWorkspace("/account/bots/nobody/edit");
    await waitFor(() => expect(loadPage).toHaveBeenCalledExactlyOnceWith("/account/bots/nobody/edit"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a member from Add a chat bot to workspace settings, saying why", async () => {
    showWorkspace("/account/bots/new");
    expect(await screen.findByRole("alert")).toHaveTextContent("Only administrators can manage bots");
    expect(location.pathname).toBe("/account/edit");
    expect(await communitySettings()).toBeInTheDocument();
  });
});

describe("Agent pages", () => {
  const asAdministrator: Me = { ...ada, administrator: true };
  /** Ember AI on GLM-4.7 Flash. */
  const assistant: AssistantSettings = {
    accountId: "0123456789abcdef0123456789abcdef",
    model: "@cf/zai-org/glm-4.7-flash",
    models: [{ id: "@cf/zai-org/glm-4.7-flash", name: "GLM-4.7 Flash", format: "chat" }],
    most: { thinking: "high", length: "long" },
    webTools: null,
    instructions: "",
    promptTemplate: null,
    avatarUrl: "/users/ember.abc/avatar?v=20261101120000",
    avatar: false,
  };
  const recap: AgentSettings = {
    id: "a1",
    name: "Recap",
    bio: null,
    role: "bot",
    status: "active",
    avatarUrl: "/users/a1/avatar?v=1",
    description: "Sums up threads into decisions and to-dos.",
    model: assistant.model,
    modelName: "GLM-4.7 Flash",
    webTools: [],
    rooms: null,
    instructions: "Sum up the conversation so far.",
    promptTemplate: null,
    format: "chat",
    levels: { thinking: "low", length: "medium" },
    thinkingLevels: [...THINKING_LEVELS],
    avatar: false,
    changedBy: { id: ada.id, name: ada.name },
    changedAt: "2026-11-09T12:00:00.000Z",
  };
  /** A connected app, as its page shows it. */
  const linear = {
    id: "p1",
    name: "Linear",
    url: "https://mcp.linear.example/mcp",
    hasToken: false,
    serverName: null,
    tools: [{ name: "create_issue", title: null, description: "Creates an issue." }],
    toolsLeftOut: 0,
    toolsReadAt: "2026-11-13T10:30:00.000Z",
    connectedBy: { id: ada.id, name: ada.name },
  };
  /** What an administrator's workspace answers while Ember AI is on. */
  const withAgents = (responses: Parameters<typeof serve>[0] = {}) =>
    serve({
      "GET /api/account": () => Response.json({ ...workspaceSettings, canAdminister: true, assistant }),
      "GET /api/account/agents": () => Response.json({ agents: [recap] }),
      "GET /api/account/apps": () => Response.json({ apps: [{ id: linear.id, name: linear.name, url: linear.url, toolCount: linear.tools.length }] }),
      "POST /api/account/assistant/offered": () => Response.json(SHIPPED_MODELS),
      // The Tools card of each agent's page.
      "GET /api/account/agents/a1/tools": () => Response.json({ apps: [] }),
      "GET /api/account/agents/ember/tools": () => Response.json({ apps: [] }),
      ...responses,
    });
  const sectionMarked = () => within(screen.getByRole("navigation", { name: "Community settings" })).getByRole("link", { current: "page" });

  it("shows the agents' pages at their addresses from the AI assistant tab, marking it, and Admin on the rail, with Go Back to it", async () => {
    withAgents({ "GET /api/account/agents/a1": () => Response.json({ agent: recap }) });
    const { user } = showWorkspace("/account/edit#assistant-settings", asAdministrator);
    await user.click(await screen.findByRole("link", { name: "Edit Recap" }, { timeout: 10_000 }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Recap");
    expect(document.title).toBe("Edit agent");
    expect(railCurrent()).toEqual(["Admin"]);
    expect(sectionMarked()).toHaveTextContent("AI assistant");

    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await user.click(await screen.findByRole("link", { name: "Edit Ember" }));
    expect(await screen.findByRole("region", { name: "@ember" })).toBeInTheDocument();
    expect(railCurrent()).toEqual(["Admin"]);
    expect(sectionMarked()).toHaveTextContent("AI assistant");

    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await user.click(await screen.findByRole("link", { name: "New agent" }));
    expect(await screen.findByRole("heading", { level: 1, name: "New agent" })).toBeInTheDocument();
    expect(document.title).toBe("New agent");
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await screen.findByRole("region", { name: "Agents" })).toBeInTheDocument();
  });

  it("shows the apps' pages at their addresses from the AI assistant tab, marking it, and Admin on the rail, with Go Back to it", async () => {
    withAgents({ "GET /api/account/apps/p1": () => Response.json({ app: linear }) });
    const { user } = showWorkspace("/account/edit#assistant-settings", asAdministrator);
    await user.click(await screen.findByRole("link", { name: "Edit Linear" }));
    expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue("Linear");
    expect(location.pathname).toBe("/account/apps/p1/edit");
    expect(document.title).toBe("Edit app");
    expect(railCurrent()).toEqual(["Admin"]);
    expect(sectionMarked()).toHaveTextContent("AI assistant");

    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await user.click(await screen.findByRole("link", { name: "Connect an app" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Connect an app" })).toBeInTheDocument();
    expect(location.pathname).toBe("/account/apps/new");
    expect(document.title).toBe("Connect an app");
    expect(sectionMarked()).toHaveTextContent("AI assistant");
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await screen.findByRole("region", { name: "Apps" })).toBeInTheDocument();
  });

  it("loads an app's page again when no app has the id, for the Worker to answer the 404 page", async () => {
    vi.mocked(loadPage).mockClear();
    withAgents({ "GET /api/account/apps/nothing": () => Response.json({ error: "Not found" }, { status: 404 }) });
    showWorkspace("/account/apps/nothing/edit", asAdministrator);
    await waitFor(() => expect(loadPage).toHaveBeenCalledExactlyOnceWith("/account/apps/nothing/edit"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads an agent's settings again when no agent has the id, for the Worker to answer the 404 page", async () => {
    vi.mocked(loadPage).mockClear();
    withAgents({ "GET /api/account/agents/nobody": () => Response.json({ error: "Not found" }, { status: 404 }) });
    showWorkspace("/account/agents/nobody/edit", asAdministrator);
    await waitFor(() => expect(loadPage).toHaveBeenCalledExactlyOnceWith("/account/agents/nobody/edit"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends a member from New agent, or @ember's page, to workspace settings, saying why", async () => {
    for (const path of ["/account/agents/new", "/account/agents/ember/edit"]) {
      const { unmount } = showWorkspace(path);
      expect(await screen.findByRole("alert")).toHaveTextContent("Only administrators can set up agents");
      expect(location.pathname).toBe("/account/edit");
      expect(await communitySettings()).toBeInTheDocument();
      unmount();
    }
  });
});

describe("App icon badge", () => {
  it("badges the app with Activity's count, the conversations marked unread but the one shown, as it changes, and clears the badge at none", async () => {
    const badges = badgeTheApp();
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({ "GET /api/sidebar": () => Response.json(roomList([...rooms, withGrace])) });
    showWorkspace("/rooms/general");
    await roomHeading();
    await waitFor(() => expect(badges).toEqual(["cleared"]));

    await workspaceSends({ type: "room.unread", roomId: "random", at: NOON });
    await workspaceSends({ type: "room.unread", roomId: withGrace.id, at: NOON });
    // The room shown counts as read.
    await workspaceSends({ type: "room.unread", roomId: "general", at: NOON });
    await workspaceSends({ type: "room.read", roomId: "random" });
    await workspaceSends({ type: "room.read", roomId: withGrace.id });
    expect(badges).toEqual(["cleared", 1, 2, 1, "cleared"]);
  });

  it("leaves the badge as it is until the list has come, as a push may have set it", async () => {
    const badges = badgeTheApp();
    serve({ "GET /api/sidebar": () => new Promise<Response>(() => {}) });
    showWorkspace("/rooms/general");
    await waitFor(() => expect(roomListRequests()).toBe(1));
    expect(badges).toEqual([]);
  });

  it("leaves the badge as it is when the list fails to come, which says nothing of what's unread", async () => {
    const badges = badgeTheApp();
    serve({ "GET /api/sidebar": () => Promise.reject(new TypeError("Failed to fetch")) });
    showWorkspace("/rooms/general");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't reach Ember");
    expect(badges).toEqual([]);
  });
});

describe("Community settings page", () => {
  const settingsNavigation = () => screen.getByRole("navigation", { name: "Community settings" });
  const sectionMarked = () => within(settingsNavigation()).getByRole("link", { current: "page" });
  const settingsRequests = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/account").length;

  it("puts community settings' links in the sidebar's place, under a header labelled Community settings, in the order they show", async () => {
    showWorkspace("/account/edit");
    expect(await communitySettings()).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Conversations" })).not.toBeInTheDocument();
    const header = screen.getByRole("navigation", { name: "Page" });
    // Labelled, not headed: the page's own title is its one h1.
    expect(header).toHaveTextContent("Community settings");
    expect(within(header).queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(sectionMarked()).toHaveTextContent("General");
    // Ada isn't an administrator.
    expect(within(settingsNavigation()).getAllByRole("link").map((link) => link.textContent)).toEqual(["General", "Rooms and permissions", "Membership"]);
    // The header, the links, then the page, as they show.
    const following = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(following(header, settingsNavigation())).toBe(true);
    expect(following(settingsNavigation(), screen.getByRole("main"))).toBe(true);
  });

  it("shows the section a link picks in place, marking it, without loading the settings again", async () => {
    const { user } = showWorkspace("/account/edit");
    await communitySettings();
    await user.click(screen.getByRole("link", { name: "Membership" }));
    expect(location.pathname + location.hash).toBe("/account/edit#membership-settings");
    expect(sectionMarked()).toHaveTextContent("Membership");
    expect(screen.getByRole("heading", { level: 1, name: "Membership" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Basic community settings" })).not.toBeInTheDocument();
    expect(settingsRequests()).toBe(1);
    expect(document.title).toBe("Community settings");
  });

  it("starts a section at its top", async () => {
    const { user } = showWorkspace("/account/edit");
    await communitySettings();
    const main = screen.getByRole("main");
    main.scrollTop = 400;
    await user.click(screen.getByRole("link", { name: "Rooms and permissions" }));
    expect(main.scrollTop).toBe(0);
  });

  it("shows the room forms as part of Rooms and permissions", async () => {
    serve({ "GET /api/rooms/new": () => Response.json({ people: [ada], parents: [] }) });
    showWorkspace("/rooms/opens/new");
    await screen.findByRole("textbox", { name: "Room name" });
    expect(sectionMarked()).toHaveTextContent("Rooms and permissions");
    expect(screen.queryByRole("complementary", { name: "Conversations" })).not.toBeInTheDocument();
    expect(railCurrent()).toEqual(["Workspace"]);
  });
});


describe("Conversations drawer on phones", () => {
  it("holds the rail alone on community settings' pages, named for navigation, focusing its first link as it opens", async () => {
    const { user } = showWorkspace("/account/edit");
    await communitySettings();
    await user.click(screen.getByRole("button", { name: "Open navigation", expanded: false }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    expect(within(drawer).getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(within(drawer).queryByRole("complementary")).not.toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Ember home" })).toHaveFocus();
    expect(drawer).not.toContainElement(screen.getByRole("button", { name: "Close navigation", expanded: true, hidden: true }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus());
  });
});

describe("Huddles", () => {
  const HUDDLES_ON: Account = { ...workspaceSettings.account, huddles: true };
  const preview = () => screen.queryByRole("dialog", { name: /huddle in/ });
  const bar = () => screen.queryByRole("region", { name: /^Huddle/ });
  /** What the tab's huddle is asked to do. */
  const controls = { leave: vi.fn(() => showHuddle(null)), setMuted: vi.fn() } satisfies HuddleControls;
  /** Serves `sidebar` as this person's rooms, and a search that finds nothing, as the search box and its page ask. */
  const serveRooms = (sidebar: object = roomList(rooms)) =>
    serve({
      "GET /api/sidebar": () => Response.json(sidebar),
      "GET /api/searches?q=": () => Response.json({ search: null, matches: [], next: null, rooms: [], recent: [] }),
    });

  beforeEach(() => {
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serveRooms();
    controls.leave.mockClear();
    controls.setMuted.mockClear();
    // Joining lets the tab into the huddle at once, alone.
    vi.mocked(joinHuddle).mockImplementation(({ roomId, muted }) =>
      showHuddle({ roomId, connected: true, you: ada, people: [{ user: ada, muted, audio: false }], muted, microphone: true }, controls),
    );
  });

  afterEach(() => {
    act(() => showHuddle(null));
    vi.mocked(joinHuddle).mockReset();
  });

  /** What a room's row in the sidebar says of the huddle going on in it, or nothing with none. */
  const inSidebar = (room: string) => within(screen.getByRole("region", { name: "Rooms" })).getByRole("link", { name: room }).querySelector("[title]");

  it("has no huddle button until huddles are on, nor a sidebar that says a huddle is going on", async () => {
    serveRooms({ ...roomList(rooms), huddles: { general: { startedAt: "2026-11-10T09:00:00.000Z", userIds: ["u2"] } } });
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.queryByRole("button", { name: /huddle/i })).not.toBeInTheDocument();
    expect(inSidebar("general")).toBeNull();
  });

  it("has none in a DM", async () => {
    serveRooms(roomList([...rooms, withGrace]));
    showWorkspace("/rooms/d1", ada, HUDDLES_ON);
    expect(await roomHeading()).toHaveTextContent("Grace");
    expect(screen.queryByRole("button", { name: /huddle/i })).not.toBeInTheDocument();
  });

  it("starts a room's huddle from its header by the preview, then shows its bar under every page until it's left", async () => {
    const { user } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    // First of the room's actions, where Slack's is.
    const start = screen.getByRole("button", { name: "Start huddle" });
    expect(start.compareDocumentPosition(screen.getByRole("link", { name: "Search messages" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(start);
    expect(await screen.findByRole("dialog", { name: "Start a huddle in general" })).toBeVisible();
    expect(bar()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start Huddle" }));
    expect(joinHuddle).toHaveBeenCalledExactlyOnceWith({ roomId: "general", muted: false, microphone: null, speakerId: "" });
    expect(preview()).not.toBeInTheDocument();
    expect(bar()).toHaveAccessibleName("Huddle in general");
    expect(screen.getByRole("button", { name: "Leave huddle" })).toBeInTheDocument();

    // On another room's page, and a page that isn't a room's.
    act(() => navigate("/rooms/random"));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(bar()).toHaveAccessibleName("Huddle in general");
    expect(screen.getByRole("button", { name: "Start huddle" })).toBeInTheDocument();
    act(() => navigate("/searches"));
    expect(await screen.findByRole("heading", { name: "Find a conversation" })).toBeInTheDocument();
    expect(bar()).toHaveAccessibleName("Huddle in general");
    await user.click(within(bar()!).getByRole("link"));
    expect(await roomHeading()).toHaveTextContent("general");

    await user.click(within(bar()!).getByRole("button", { name: "Leave" }));
    expect(controls.leave).toHaveBeenCalledTimes(1);
    expect(bar()).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start huddle" })).toBeInTheDocument();
  });

  it("leaves from the header's button while the tab is in the room's huddle", async () => {
    const { user } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    act(() => joinHuddle({ roomId: "general", muted: false, microphone: null, speakerId: "" }));
    await user.click(screen.getByRole("button", { name: "Leave huddle" }));
    expect(controls.leave).toHaveBeenCalledTimes(1);
    expect(preview()).not.toBeInTheDocument();
  });

  it("offers to join a huddle the workspace socket says is going on, with how many are in it", async () => {
    const { user } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    await workspaceSends({ type: "room.huddle", roomId: "general", huddle: { startedAt: "2026-11-10T09:00:00.000Z", userIds: ["u2", "u3"] } });
    await user.click(await screen.findByRole("button", { name: "Join huddle, 2 in it" }));
    expect(await screen.findByRole("dialog", { name: "Join the huddle in general" })).toHaveAccessibleDescription("2 people are in it now.");
    // It follows the huddle while it's open.
    await workspaceSends({ type: "room.huddle", roomId: "general", huddle: null });
    expect(await screen.findByRole("dialog", { name: "Start a huddle in general" })).toBeVisible();
  });

  it("lists the huddles going on as the sidebar loads them, in the room's header and at the end of its row in the sidebar", async () => {
    serveRooms({ ...roomList(rooms), huddles: { random: { startedAt: "2026-11-10T09:00:00.000Z", userIds: ["u2"] } } });
    showWorkspace("/rooms/random", ada, HUDDLES_ON);
    expect(await screen.findByRole("button", { name: "Join huddle, 1 in it" })).toBeInTheDocument();
    expect(inSidebar("random")).toHaveTextContent(/^1/);
    expect(inSidebar("general")).toBeNull();

    // The row follows the huddle as the workspace socket tells of it.
    await workspaceSends({ type: "room.huddle", roomId: "random", huddle: { startedAt: "2026-11-10T09:00:00.000Z", userIds: ["u2", "u3"] } });
    await waitFor(() => expect(inSidebar("random")).toHaveTextContent(/^2/));
    await workspaceSends({ type: "room.huddle", roomId: "general", huddle: { startedAt: "2026-11-10T09:05:00.000Z", userIds: ["u1"] } });
    await waitFor(() => expect(inSidebar("general")).toHaveAttribute("title", "Just you in the huddle"));
    await workspaceSends({ type: "room.huddle", roomId: "random", huddle: null });
    await waitFor(() => expect(inSidebar("random")).toBeNull());
  });

  it("opens the preview from a huddle's link, and leaves the room's address in its place", async () => {
    vi.mocked(loadPage).mockClear();
    showWorkspace("/rooms/random/huddle", ada, HUDDLES_ON);
    expect(await screen.findByRole("dialog", { name: "Start a huddle in random" })).toBeVisible();
    // The room is under the preview, which hides it from screen readers meanwhile.
    expect(screen.getByRole("heading", { level: 1, hidden: true })).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("shows the room at its huddle's link, and says so, while huddles are off", async () => {
    showWorkspace("/rooms/random/huddle");
    expect(await screen.findByRole("alert")).toHaveTextContent("Huddles are turned off.");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
    expect(preview()).not.toBeInTheDocument();
  });

  it("only shows the room at the link of a huddle the tab is in, or of a DM", async () => {
    serveRooms(roomList([...rooms, withGrace]));
    act(() => joinHuddle({ roomId: "random", muted: false, microphone: null, speakerId: "" }));
    showWorkspace("/rooms/random/huddle", ada, HUDDLES_ON);
    expect(await roomHeading()).toHaveTextContent("random");
    await waitFor(() => expect(location.pathname).toBe("/rooms/random"));
    act(() => navigate("/rooms/d1/huddle"));
    expect(await roomHeading()).toHaveTextContent("Grace");
    await waitFor(() => expect(location.pathname).toBe("/rooms/d1"));
    expect(preview()).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says the room isn't this person's at the huddle's link of a room that isn't", async () => {
    showWorkspace("/rooms/secret/huddle", ada, HUDDLES_ON);
    expect(await screen.findByRole("alert")).toHaveTextContent("You don’t have access to this room");
    expect(preview()).not.toBeInTheDocument();
  });

  it("starts, joins and leaves on Ctrl+Alt+Shift+H, which a dialog keeps", async () => {
    const { user } = showWorkspace("/rooms/random", ada, HUDDLES_ON);
    await roomHeading();
    const toggle = (target: Element = document.body) => fireEvent.keyDown(target, { key: "H", code: "KeyH", ctrlKey: true, altKey: true, shiftKey: true });
    expect(toggle()).toBe(false);
    const dialog = await screen.findByRole("dialog", { name: "Start a huddle in random" });
    // In the preview, as in any dialog, the keys do nothing.
    expect(toggle(within(dialog).getByRole("button", { name: "Start Huddle" }))).toBe(true);
    expect(joinHuddle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Start Huddle" }));
    expect(bar()).toHaveAccessibleName("Huddle in random");

    // Wherever the tab is, they leave the huddle it's in.
    act(() => navigate("/rooms/general"));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(toggle()).toBe(false);
    expect(controls.leave).toHaveBeenCalledTimes(1);
    expect(bar()).not.toBeInTheDocument();
    expect(preview()).not.toBeInTheDocument();
  });

  it("leaves the huddle's keys alone where there's no huddle to start: with huddles off, in a DM, and off a room's page", async () => {
    serveRooms(roomList([...rooms, withGrace]));
    const toggle = () => fireEvent.keyDown(document.body, { key: "H", code: "KeyH", ctrlKey: true, altKey: true, shiftKey: true });
    const off = showWorkspace("/rooms/general");
    await roomHeading();
    expect(toggle()).toBe(true);
    off.unmount();

    showWorkspace("/rooms/d1", ada, HUDDLES_ON);
    expect(await roomHeading()).toHaveTextContent("Grace");
    expect(toggle()).toBe(true);
    act(() => navigate("/searches"));
    expect(toggle()).toBe(true);
    expect(preview()).not.toBeInTheDocument();
  });

  it("mutes and unmutes on Ctrl+Shift+Space while the tab is in a huddle, even from a dialog, and leaves the keys alone otherwise", async () => {
    const { user } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    const mute = (target: Element = document.body) => fireEvent.keyDown(target, { key: " ", code: "Space", ctrlKey: true, shiftKey: true });
    expect(mute()).toBe(true);
    expect(controls.setMuted).not.toHaveBeenCalled();

    act(() => joinHuddle({ roomId: "general", muted: false, microphone: null, speakerId: "" }));
    expect(mute()).toBe(false);
    expect(controls.setMuted).toHaveBeenLastCalledWith(true);
    act(() => showHuddle({ ...joinedHuddle()!, muted: true }));
    await user.click(screen.getByRole("link", { name: "Search messages" }));
    expect(mute(screen.getByRole("combobox", { name: "Search" }))).toBe(false);
    expect(controls.setMuted).toHaveBeenLastCalledWith(false);
  });

  it("counts the huddle's keys once however long they're held: muting stays, and leaving starts nothing", async () => {
    showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    const mute = { key: " ", code: "Space", ctrlKey: true, shiftKey: true };
    const toggle = { key: "H", code: "KeyH", ctrlKey: true, altKey: true, shiftKey: true };
    /** The keys pressed and held, as the browser repeats them: whether it was left any of them to act on. */
    const held = (keys: KeyboardEventInit) => [fireEvent.keyDown(document.body, keys), fireEvent.keyDown(document.body, { ...keys, repeat: true }), fireEvent.keyDown(document.body, { ...keys, repeat: true })].some(Boolean);

    act(() => joinHuddle({ roomId: "general", muted: false, microphone: null, speakerId: "" }));
    expect(held(mute)).toBe(false);
    expect(controls.setMuted).toHaveBeenCalledExactlyOnceWith(true);

    expect(held(toggle)).toBe(false);
    expect(controls.leave).toHaveBeenCalledTimes(1);
    expect(bar()).not.toBeInTheDocument();
    expect(preview()).not.toBeInTheDocument();
  });

  it("says why the room ended the tab's huddle", async () => {
    showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    act(() => joinHuddle({ roomId: "general", muted: false, microphone: null, speakerId: "" }));
    expect(bar()).toBeInTheDocument();
    act(() => endHuddle("Huddles have been turned off."));
    expect(await screen.findByRole("alert")).toHaveTextContent("Huddles have been turned off.");
    expect(bar()).not.toBeInTheDocument();
  });

  it("closes the preview of a room that stops being this person's, for good", async () => {
    const { user } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Start huddle" }));
    expect(await screen.findByRole("dialog", { name: "Start a huddle in general" })).toBeVisible();
    await workspaceSends({ type: "room.gone", roomId: "general" });
    await waitFor(() => expect(preview()).not.toBeInTheDocument());
    await workspaceSends({ type: "room.saved", room: rooms[0]! });
    await waitFor(() => expect(sidebarRooms()).toContain("general"));
    expect(preview()).not.toBeInTheDocument();
  });

  it("leaves the huddle as the workspace goes, as when someone else signs in", async () => {
    const { unmount } = showWorkspace("/rooms/general", ada, HUDDLES_ON);
    await roomHeading();
    act(() => joinHuddle({ roomId: "general", muted: false, microphone: null, speakerId: "" }));
    unmount();
    expect(controls.leave).toHaveBeenCalledTimes(1);
  });
});
