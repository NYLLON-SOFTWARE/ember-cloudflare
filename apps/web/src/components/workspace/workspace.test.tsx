import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Room, RoomSettings } from "@ember/protocol";
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

function showWorkspace(path = "/") {
  const [onSignOut, onSessionChanged] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  render(<Workspace me={ada} onSignOut={onSignOut} onSessionChanged={onSessionChanged} />);
  return { onSignOut, onSessionChanged, user: userEvent.setup() };
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
