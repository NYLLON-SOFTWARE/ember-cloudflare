import { feature } from "@ember/parity";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspace } from "./workspace";

const ada = { id: "u1", name: "Ada" };
const rooms = [
  { id: "general", name: "general", kind: "open" },
  { id: "random", name: "random", kind: "open" },
];

/** A socket that never connects: these tests are about the layout around the room. */
class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

function showWorkspace(path = "/") {
  const [onSignOut, onSessionExpired] = [vi.fn(), vi.fn()];
  history.replaceState(null, "", path);
  render(<Workspace me={ada} onSignOut={onSignOut} onSessionExpired={onSessionExpired} />);
  return { onSignOut, onSessionExpired, user: userEvent.setup() };
}

const roomHeading = () => screen.findByRole("heading", { level: 1 });

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
    const { onSignOut, onSessionExpired } = showWorkspace();
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
    // The session is already gone, so there's nothing to sign out of.
    expect(onSignOut).not.toHaveBeenCalled();
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
