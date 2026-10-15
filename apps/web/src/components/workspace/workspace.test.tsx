import { feature } from "@ember/parity";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, type Me, type Message, type Room, type RoomId, type RoomSettings, type SidebarRoom, type WorkspaceSettings } from "@ember/protocol";
import { FlashProvider } from "@/components/flash";
import { navigate } from "@/hooks/use-route";
import { Workspace } from "./workspace";

const ada: Me = { id: "u1", name: "Ada", administrator: false };
const rooms: Room[] = [
  { id: "general", name: "general", kind: "open", icon: null },
  { id: "random", name: "random", kind: "open", icon: null },
];
/** The sidebar's list of `listed`, with the rooms starred in `favorites`. */
const roomList = (listed: Room[], favorites: RoomId[] = []) => ({ rooms: listed, favorites: { rooms: favorites, version: 0 }, invitation: null });
const generalSettings: RoomSettings = { room: rooms[0]!, canAdminister: true, people: [{ ...ada, member: true }] };
const workspaceSettings: WorkspaceSettings = { account: { name: "Analytical Engines" }, joinCode: "aB3d-Ef5h-iJ7k", canAdminister: false };

/**
 * Answers each request as `responses` says, by its method and path, such as "POST /api/rooms", with
 * the workspace's settings for "GET /api/account", nobody for "GET /api/users", and the room list for
 * anything else.
 */
function serve(responses: Record<string, () => Response | Promise<Response>> = {}) {
  const answers: typeof responses = {
    "GET /api/account": () => Response.json(workspaceSettings),
    "GET /api/users": () => Response.json({ users: [] }),
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

function showWorkspace(path = "/") {
  const [onAccountChanged, onSignOut, onSessionChanged] = [vi.fn(), vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  const { unmount } = render(
    <FlashProvider workspace>
      <Workspace
        me={ada}
        workspaceName="Analytical Engines"
        version="0.1"
        onAccountChanged={onAccountChanged}
        onSignOut={onSignOut}
        onSessionChanged={onSessionChanged}
      />
    </FlashProvider>,
  );
  return { onAccountChanged, onSignOut, onSessionChanged, unmount, user: userEvent.setup() };
}

const roomHeading = () => screen.findByRole("heading", { level: 1 });
/** The rooms in the sidebar, in order. */
const sidebarRooms = () => within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link").map((link) => link.textContent!.replace(/^#/, ""));
/** The rail's links for the page shown, if any. */
const railCurrent = () =>
  within(screen.getByRole("navigation", { name: "Workspace" }))
    .queryAllByRole("link", { current: "page" })
    .map((link) => link.getAttribute("aria-label") ?? link.textContent);
/** How many times the room list was asked for. */
const roomListRequests = () => vi.mocked(fetch).mock.calls.filter(([input]) => String(input) === "/api/sidebar").length;

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

describe(feature("rooms.show"), () => {
  it("opens the room in the address, named in the tab", async () => {
    showWorkspace("/rooms/random");
    expect(await roomHeading()).toHaveTextContent("random");
    await waitFor(() => expect(document.title).toBe("random"));
  });

  it("goes home with ember-rust's alert from a room you can't see, once the list, asked again, hasn't got it either", async () => {
    showWorkspace("/rooms/secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
    expect(roomListRequests()).toBe(2);
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
    await roomHeading();
    act(() => navigate("/rooms/secret"));
    await waitFor(() => expect(roomListRequests()).toBe(3));
    expect(await roomHeading()).toHaveTextContent("general");
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

describe(feature("rooms.last-visited"), () => {
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
    expect(screen.getByRole("main").querySelector("img")).toHaveAttribute("aria-hidden", "true");
    expect(location.pathname).toBe("/");
    expect(railCurrent()).toEqual(["Ember home", "Home"]);
  });

  it("goes back from workspace settings and a room's settings to the room visited last", async () => {
    serve({ "GET /api/rooms/general/settings": () => Response.json(generalSettings) });
    const { user } = showWorkspace("/rooms/random");
    await roomHeading();
    act(() => navigate("/rooms/opens/general/edit"));
    await screen.findByRole("textbox", { name: "Room name" });
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");

    await user.click(screen.getByRole("link", { name: "Workspace" }));
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
  });

  it("goes back home from workspace settings when you have no rooms", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList([])) });
    showWorkspace("/account/edit");
    await waitFor(() => expect(screen.getByRole("link", { name: "Go Back" })).toHaveAttribute("href", "/"));
  });
});

describe(feature("rooms.index"), () => {
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

  it("goes home with the alert from the address for a kind of room you can't see", async () => {
    showWorkspace("/rooms/closeds/secret");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
  });

  it("goes from a direct message's address to the room's own without looking, which then looks", async () => {
    showWorkspace("/rooms/directs/random");
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });

  it("reads /rooms/opens as a room's id, as ember-rust does", async () => {
    showWorkspace("/rooms/opens");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    await waitFor(() => expect(location.pathname).toBe("/rooms/general"));
  });
});

describe(feature("rooms.create-open"), () => {
  it("makes a room from workspace settings, lists it in its place by name, and opens it", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
      "POST /api/rooms": () => Response.json({ room: design }, { status: 201 }),
    });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Workspace settings" })).toBeInTheDocument();
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
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
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

describe(feature("rooms.settings-page"), () => {
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
    // The settings are nobody's current room.
    expect(within(screen.getByRole("region", { name: "Rooms" })).queryAllByRole("link", { current: "page" })).toEqual([]);
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
      "GET /api/rooms/older/settings": () => Response.json({ room: older, canAdminister: true, people: [{ ...ada, member: true }] }),
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

  it("goes back to the room it was opened from", async () => {
    serve({ "GET /api/rooms/random/settings": () => Response.json({ ...generalSettings, room: rooms[1] }) });
    const { user } = showWorkspace("/rooms/random");
    await user.click(await screen.findByRole("link", { name: "Settings for this room" }));
    await screen.findByRole("textbox", { name: "Room name" });
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });
});

describe(feature("rooms.edit-permissions"), () => {
  it("goes home with an alert from the settings of a room that isn't there, or isn't yours", async () => {
    serve({ "GET /api/rooms/secret/settings": () => Response.json({ error: "Room not found or inaccessible" }, { status: 404 }) });
    showWorkspace("/rooms/opens/secret/edit");
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await roomHeading()).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
  });
});

describe(feature("rooms.members"), () => {
  it("goes home with ember-rust's alert when you save a room without yourself, and it leaves the sidebar", async () => {
    const leadsRoom: Room = { id: "leads", name: "Leads", kind: "closed", icon: null };
    serve({
      "GET /api/sidebar": () => Response.json(roomList([...rooms, leadsRoom])),
      "GET /api/rooms/leads/settings": () => Response.json({ room: leadsRoom, canAdminister: true, people: [{ ...ada, member: true }] }),
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

describe(feature("rooms.member-only-access"), () => {
  it("keeps a room that's gone on screen, saying it was deleted, and takes it out of the sidebar", async () => {
    vi.stubGlobal("WebSocket", goneRoom("random"));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    const { user } = showWorkspace("/rooms/random");
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));
    expect(screen.getByRole("alert")).toHaveTextContent("This room was deleted.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("random");
    expect(screen.queryByRole("textbox", { name: "Write a message" })).not.toBeInTheDocument();

    vi.stubGlobal("WebSocket", OpenRoomSocket);
    await user.click(within(screen.getByRole("region", { name: "Rooms" })).getByRole("link", { name: /general/ }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(await screen.findByRole("textbox", { name: "Write a message" })).toHaveAttribute("placeholder", "Message #general");
  });

  it("leaves the messages of a room that's gone with nothing to do to them", async () => {
    const said: Message = { id: "m1", clientMessageId: "c1", roomId: "random", creator: ada, body: "<p>Before it went</p>", plainText: "Before it went", mentions: [], createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z", editedAt: null, boosts: [] };
    vi.stubGlobal("WebSocket", goneRoom("random", [said]));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/rooms/random");
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));
    expect(screen.getByRole("alert")).toHaveTextContent("This room was deleted.");
    const article = screen.getByText("Before it went").closest("article")!;
    expect(within(article).queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
  });

  it("keeps a room / went to on screen when it goes, without asking for the list again", async () => {
    vi.stubGlobal("WebSocket", goneRoom("general"));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/");
    await waitFor(() => expect(sidebarRooms()).toEqual(["random"]));
    expect(screen.getByRole("alert")).toHaveTextContent("This room was deleted.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("general");
    expect(location.pathname).toBe("/rooms/general");
    expect(roomListRequests()).toBe(1);
  });
});

describe(feature("accounts.name"), () => {
  it("passes on the workspace's name as its settings load it, which another administrator may have changed", async () => {
    serve({ "GET /api/account": () => Response.json({ ...workspaceSettings, account: { name: "Difference Engines" } }) });
    const { onAccountChanged } = showWorkspace("/account/edit");
    await waitFor(() => expect(onAccountChanged).toHaveBeenCalledExactlyOnceWith({ name: "Difference Engines" }));
  });
});

describe(feature("ui.flash"), () => {
  it("alerts with what the server said when something fails", async () => {
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
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
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
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

describe(feature("ui.rail"), () => {
  it("titles the logo with the workspace's name", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });

  it("marks Home on a room's page, Workspace on workspace settings, and neither on a room's settings", async () => {
    serve({ "GET /api/rooms/general/settings": () => Response.json(generalSettings) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    expect(railCurrent()).toEqual(["Home"]);
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(railCurrent()).toEqual(["Workspace"]);
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    expect(railCurrent()).toEqual(["Home"]);
    await user.click(await screen.findByRole("link", { name: "Settings for this room" }));
    expect(railCurrent()).toEqual([]);
  });
});

describe(feature("sidebar.activity-filter"), () => {
  const marked: SidebarRoom[] = [{ ...rooms[0]!, unread: true }, { ...rooms[1]!, unread: true }, { id: "design", name: "Design", kind: "open", icon: null, unread: false }];
  const activity = () => screen.getByRole("button", { name: "Activity" });
  // The sidebar's rooms, which workspace settings has a section named for too.
  const sidebarRooms = () => within(screen.getByRole("complementary", { name: "Conversations" })).getAllByRole("link").map((link) => link.textContent!.replace(/^#/, ""));
  const roomLink = (name: RegExp) => within(screen.getByRole("complementary", { name: "Conversations" })).getByRole("link", { name });

  /** A workspace socket that welcomes Ada, then says random has been marked unread for her. */
  class MarkingSocket extends QuietSocket {
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor(url: string) {
      super();
      if (!url.includes("/api/socket")) return;
      setTimeout(() => {
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "welcome", you: ada }) });
        this.onmessage?.({ data: JSON.stringify({ type: "room.unread", roomId: "random" }) });
      });
    }
  }

  it("counts the conversations marked unread but the one shown, and shows only them while it's on", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList(marked)) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await waitFor(() => expect(activity()).toHaveAccessibleDescription("1 unread"));
    await user.click(activity());
    expect(activity()).toHaveAttribute("aria-pressed", "true");
    expect(sidebarRooms()).toEqual(["random"]);
    expect(railCurrent()).toEqual([]);

    await user.click(activity());
    expect(activity()).toHaveAttribute("aria-pressed", "false");
    expect(sidebarRooms()).toEqual(["Design", "general", "random"]);
    expect(railCurrent()).toEqual(["Home"]);
  });

  it("counts a room as it's marked", async () => {
    vi.stubGlobal("WebSocket", MarkingSocket);
    showWorkspace("/rooms/general");
    await roomHeading();
    await waitFor(() => expect(activity()).toHaveAccessibleDescription("1 unread"));
  });

  it("turns off when you follow a rail or sidebar link, and stays on through other navigation", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList(marked)) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(activity());
    act(() => navigate("/account/edit"));
    expect(await screen.findByRole("heading", { level: 1, name: "Workspace settings" })).toBeInTheDocument();
    expect(activity()).toHaveAttribute("aria-pressed", "true");
    // With no room shown, general counts too.
    expect(sidebarRooms()).toEqual(["general", "random"]);

    await user.click(roomLink(/random/));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(activity()).toHaveAttribute("aria-pressed", "false");

    await user.click(activity());
    await user.click(screen.getByRole("link", { name: "Workspace" }));
    expect(activity()).toHaveAttribute("aria-pressed", "false");
  });

  it("stays on when a link opens somewhere else", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList(marked)) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(activity());
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
      // Keeps jsdom, which can't open a tab, from following the link once the page has had the click.
      document.addEventListener("click", (event) => event.preventDefault(), { once: true });
      fireEvent.click(roomLink(/random/), init);
    }
    expect(activity()).toHaveAttribute("aria-pressed", "true");
    expect(location.pathname).toBe("/rooms/general");
  });

  it("stays on while unsaved changes keep you on the page, and turns off once they let you go", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList(marked)), "GET /api/rooms/general/settings": () => Response.json(generalSettings) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(activity());
    const changeSettings = async () => {
      act(() => navigate("/rooms/opens/general/edit"));
      await user.type(await screen.findByRole("textbox", { name: "Room name" }), "s");
    };
    await changeSettings();

    await user.click(roomLink(/general/));
    await user.click(await screen.findByRole("button", { name: "Keep editing" }));
    expect(location.pathname).toBe("/rooms/opens/general/edit");
    expect(activity()).toHaveAttribute("aria-pressed", "true");
    // Going there afterwards some other way leaves it on.
    await user.click(screen.getByRole("link", { name: "Go Back" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(activity()).toHaveAttribute("aria-pressed", "true");

    await changeSettings();
    await user.click(screen.getByRole("link", { name: "Home" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(activity()).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the drawer open on a phone, turning on or off, and filters the drawer's rooms", async () => {
    serve({ "GET /api/sidebar": () => Response.json(roomList(marked)) });
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    await user.click(within(drawer).getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBe(drawer);
    expect(within(drawer).getAllByRole("link", { name: /random|general|Design/ }).map((link) => link.textContent)).toEqual(["#random"]);
    await user.click(within(drawer).getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBe(drawer);
    expect(within(drawer).getByRole("button", { name: "Activity" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe(feature("sidebar.rooms"), () => {
  it("switches rooms from the sidebar and puts the room in the address", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    const sidebar = screen.getAllByRole("region", { name: "Rooms" })[0]!;
    await user.click(within(sidebar).getByRole("link", { name: /random/ }));
    expect(await roomHeading()).toHaveTextContent("random");
    expect(location.pathname).toBe("/rooms/random");
  });
});

describe(feature("sidebar.favorites"), () => {
  const design: Room = { id: "design", name: "Design", kind: "open", icon: null };
  const star = () => screen.getByRole("button", { name: "Favorite room" });

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
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t save your favorite. Please try again.");
    expect(star()).toHaveAttribute("aria-pressed", "false");
    expect(sidebarRooms()).toEqual(["general", "random"]);
  });
});

describe(feature("auth.sessions"), () => {
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
    serve({ "GET /api/rooms/new": () => Response.json({ people: [ada] }), "POST /api/rooms": () => new Promise((resolve) => (answer = resolve)) });
    const { onSessionChanged, user } = showWorkspace("/rooms/opens/new");
    await user.type(await screen.findByRole("textbox", { name: "Room name" }), "{Enter}");
    act(() => navigate("/account/edit"));
    await act(async () => answer(Response.json({ error: "Not signed in" }, { status: 401 })));
    expect(onSessionChanged).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("says nothing more once another person's workspace has taken its place", async () => {
    let answer = (_: Response) => {};
    serve({ "GET /api/rooms/new": () => Response.json({ people: [ada] }), "POST /api/rooms": () => new Promise((resolve) => (answer = resolve)) });
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

describe(feature("ui.mobile-drawer"), () => {
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
    await user.click(screen.getByRole("button", { name: "Open conversations", expanded: false }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    // The drawer hides the page behind it from screen readers, the header's button too.
    expect(drawer).not.toContainElement(screen.getByRole("button", { name: "Close conversations", expanded: true, hidden: true }));
    expect(within(drawer).getByRole("button", { name: "Close conversations" })).toHaveFocus();
  });

  it("puts its close button first in the conversations' tab order", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.tab();
    expect(within(screen.getByRole("dialog")).getByRole("link", { name: /general/ })).toHaveFocus();
    await user.tab({ shift: true });
    await user.tab({ shift: true });
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Your profile" })).toHaveFocus();
  });

  it("closes when a rail link shows another page", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    await user.click(within(drawer).getByRole("link", { name: "Workspace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { level: 1, name: "Workspace settings" })).toBeInTheDocument();
  });

  it("closes when you follow a link to the page shown", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("link", { name: /general/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "Workspace" }));
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
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
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) openElsewhere("Workspace", init);
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument();
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

describe(feature("ui.accessibility"), () => {
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

  it("names the rail, the rooms, the DMs, the messages and the composer", async () => {
    vi.stubGlobal("WebSocket", OpenRoomSocket);
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DMs" })).toBeInTheDocument();
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
