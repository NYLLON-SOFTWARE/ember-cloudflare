import { feature } from "@ember/parity";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, type Message, type Room, type RoomSettings } from "@ember/protocol";
import { navigate } from "@/hooks/use-route";
import { Workspace } from "./workspace";

const ada = { id: "u1", name: "Ada" };
const rooms: Room[] = [
  { id: "general", name: "general", kind: "open" },
  { id: "random", name: "random", kind: "open" },
];
const generalSettings: RoomSettings = { room: rooms[0]!, canAdminister: true, people: [{ ...ada, member: true }] };

/**
 * Answers each request as `responses` says, by its method and path, such as "POST /api/rooms", and
 * the room list for anything else.
 */
function serve(responses: Record<string, () => Response | Promise<Response>>) {
  vi.mocked(fetch).mockImplementation(async (input, init) => (responses[`${init?.method ?? "GET"} ${String(input)}`] ?? (() => Response.json({ rooms })))());
}

/** A socket that never connects: these tests are about the layout around the room. */
class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
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
  const [onSignOut, onSessionChanged] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  const { unmount } = render(<Workspace me={ada} onSignOut={onSignOut} onSessionChanged={onSessionChanged} />);
  return { onSignOut, onSessionChanged, unmount, user: userEvent.setup() };
}

const roomHeading = () => screen.findByRole("heading", { level: 1 });
/** The rooms in the sidebar, in order. */
const sidebarRooms = () => within(screen.getByRole("region", { name: "Rooms" })).getAllByRole("link").map((link) => link.textContent!.replace(/^#/, ""));
/** The rail's link for the page shown, if any. */
const railCurrent = () => within(screen.getByRole("navigation", { name: "Workspace" })).queryAllByRole("link", { current: "page" }).map((link) => link.textContent);

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietSocket);
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ rooms }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  history.replaceState(null, "", "/");
});

describe(feature("rooms.show"), () => {
  it("opens the room in the address", async () => {
    showWorkspace("/rooms/random");
    expect(await roomHeading()).toHaveTextContent("random");
  });

  it("opens the first room when the address names none, or one you can't see", async () => {
    showWorkspace("/rooms/secret");
    expect(await roomHeading()).toHaveTextContent("general");
  });
});

describe(feature("rooms.create-open"), () => {
  it("makes a room from workspace settings, lists it in its place by name, and opens it", async () => {
    const design: Room = { id: "design", name: "Design", kind: "open" };
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
    const design: Room = { id: "design", name: "Design", kind: "open" };
    let answer = (_: Response) => {};
    serve({
      "GET /api/rooms": () => new Promise((resolve) => (answer = resolve)),
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
      "POST /api/rooms": () => Response.json({ room: design }, { status: 201 }),
    });
    const { user } = showWorkspace("/rooms/opens/new");
    await user.type(await screen.findByRole("textbox", { name: "Room name" }), "{Enter}");
    await waitFor(() => expect(location.pathname).toBe("/rooms/design"));
    // The list answers as it was before the room was made.
    await act(async () => answer(Response.json({ rooms })));
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

  it("goes back to the room", async () => {
    serve({ "GET /api/rooms/random/settings": () => Response.json({ ...generalSettings, room: rooms[1] }) });
    const { user } = showWorkspace("/rooms/opens/random/edit");
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
    expect(location.pathname).toBe("/");
    expect(await roomHeading()).toHaveTextContent("general");
  });
});

describe(feature("rooms.members"), () => {
  it("goes home with ember-rust's alert when you save a room without yourself, and it leaves the sidebar", async () => {
    const leadsRoom: Room = { id: "leads", name: "Leads", kind: "closed" };
    serve({
      "GET /api/rooms": () => Response.json({ rooms: [...rooms, leadsRoom] }),
      "GET /api/rooms/leads/settings": () => Response.json({ room: leadsRoom, canAdminister: true, people: [{ ...ada, member: true }] }),
      "PATCH /api/rooms/leads": () => Response.json({ room: leadsRoom }),
    });
    const { user } = showWorkspace("/rooms/closeds/leads/edit");
    await user.click(await screen.findByRole("switch", { name: "Give Ada access to this room" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(location.pathname).toBe("/");
    expect(await roomHeading()).toHaveTextContent("general");
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
    expect(screen.queryByRole("textbox", { name: "Message #random" })).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("region", { name: "Rooms" })).getByRole("link", { name: /general/ }));
    expect(await roomHeading()).toHaveTextContent("general");
    expect(screen.getByRole("textbox", { name: "Message #general" })).toBeInTheDocument();
  });

  it("leaves the messages of a room that's gone with nothing to do to them", async () => {
    const said: Message = { id: "m1", clientMessageId: "c1", roomId: "random", creator: ada, body: "Before it went", createdAt: "2026-10-14T08:00:00.000Z", updatedAt: "2026-10-14T08:00:00.000Z", boosts: [] };
    vi.stubGlobal("WebSocket", goneRoom("random", [said]));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/rooms/random");
    await waitFor(() => expect(sidebarRooms()).toEqual(["general"]));
    expect(screen.getByRole("alert")).toHaveTextContent("This room was deleted.");
    const article = screen.getByText("Before it went").closest("article")!;
    expect(within(article).queryByRole("button", { name: "Message options" })).not.toBeInTheDocument();
  });

  it("keeps the first room on screen when it goes while shown at /", async () => {
    vi.stubGlobal("WebSocket", goneRoom("general"));
    serve({ "GET /api/me": () => Response.json({ user: ada }) });
    showWorkspace("/");
    await waitFor(() => expect(sidebarRooms()).toEqual(["random"]));
    expect(screen.getByRole("alert")).toHaveTextContent("This room was deleted.");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("general");
  });
});

describe(feature("ui.flash"), () => {
  it("alerts with what the server said when something fails, centered over the page", async () => {
    serve({
      "GET /api/rooms/new": () => Response.json({ people: [ada] }),
      "POST /api/rooms": () => Response.json({ error: "Name must be 1 to 100 characters" }, { status: 422 }),
    });
    const { user } = showWorkspace("/rooms/opens/new");
    await user.click(await screen.findByRole("button", { name: "Save" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Name must be 1 to 100 characters");
    expect(alert.parentElement).toHaveClass("md:left-[calc((100%+var(--spacing-rail)+var(--spacing-sidebar))/2)]");
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

describe(feature("auth.sessions"), () => {
  it("goes back to sign-in when the server no longer accepts the session", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: "Not signed in" }, { status: 401 }));
    const { onSignOut, onSessionChanged } = showWorkspace();
    await waitFor(() => expect(onSessionChanged).toHaveBeenCalledWith(null));
    // The session is already gone, so there's nothing to sign out of.
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("goes back to sign-in when a page finds the session gone", async () => {
    serve({ "GET /api/rooms/general/settings": () => Response.json({ error: "Not signed in" }, { status: 401 }) });
    const { onSessionChanged } = showWorkspace("/rooms/opens/general/edit");
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
});

describe(feature("ui.mobile-drawer"), () => {
  it("opens the rail and rooms in a drawer, and closes it after you pick a room", async () => {
    const { user } = showWorkspace("/rooms/general");
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    const drawer = screen.getByRole("dialog", { name: "Conversations" });
    expect(within(drawer).getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    await user.click(within(drawer).getByRole("link", { name: /random/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await roomHeading()).toHaveTextContent("random");
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

  it("closes on Escape", async () => {
    const { user } = showWorkspace();
    await roomHeading();
    await user.click(screen.getByRole("button", { name: "Open conversations" }));
    expect(screen.getByRole("dialog", { name: "Conversations" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe(feature("ui.accessibility"), () => {
  it("names the rail, the rooms, the DMs, the messages and the composer", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    expect(screen.getByRole("navigation", { name: "Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Rooms" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DMs" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("log", { name: "Messages in general" }));
    expect(screen.getByRole("textbox", { name: "Message #general" })).toBeInTheDocument();
  });

  it("gives every button and link a name, icon-only ones included", async () => {
    showWorkspace("/rooms/general");
    await roomHeading();
    for (const control of [...screen.getAllByRole("button"), ...screen.getAllByRole("link")]) {
      expect(control).toHaveAccessibleName();
    }
  });
});
