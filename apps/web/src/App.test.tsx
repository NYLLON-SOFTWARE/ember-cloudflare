import { feature } from "@ember/parity";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const ada = { id: "u1", name: "Ada" };
const grace = { id: "u2", name: "Grace" };

class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

/** A room socket the test answers as the room. */
class RoomSocket extends QuietSocket {
  static all: RoomSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor() {
    super();
    RoomSocket.all.push(this);
  }

  welcome(you: typeof ada) {
    this.readyState = RoomSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "welcome", you, messages: [], present: [you], hasMore: false }) });
  }
}

/** Plays the server, whose session cookie this browser starts out with or without. */
function serve({ signedIn }: { signedIn: boolean }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const route = `${init?.method ?? "GET"} ${String(input)}`;
    if (route === "POST /api/session") {
      signedIn = true;
      return Response.json({ user: ada }, { status: 201 });
    }
    if (route === "DELETE /api/session") {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    if (!signedIn) return Response.json({ error: "Not signed in" }, { status: 401 });
    if (route === "GET /api/me") return Response.json({ user: ada });
    return Response.json({ rooms: [{ id: "general", name: "general", kind: "open" }] });
  });
}

const roomHeading = () => screen.findByRole("heading", { level: 1, name: "general" });
const signInCard = () => screen.findByRole("heading", { name: "Welcome to Ember" });

async function signOutFromTheRail() {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "Your profile" })[0]!);
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("auth.sessions"), () => {
  it("opens straight into the workspace for someone already signed in", async () => {
    serve({ signedIn: true });
    render(<App />);
    expect(await roomHeading()).toBeInTheDocument();
  });

  it("shows the sign-in card when this browser isn't signed in", async () => {
    serve({ signedIn: false });
    render(<App />);
    expect(await signInCard()).toBeInTheDocument();
  });

  it("keeps asking who's signed in while the server can't be reached", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serve({ signedIn: true });
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<App />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Welcome to Ember" })).not.toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(await roomHeading()).toBeInTheDocument();
  });

  it("follows another tab that signs this browser in as someone else", async () => {
    RoomSocket.all = [];
    vi.stubGlobal("WebSocket", RoomSocket);
    serve({ signedIn: true });
    render(<App />);
    await roomHeading();

    // The other tab's cookie reaches the room when this tab's socket reconnects.
    act(() => RoomSocket.all[0]!.welcome(grace));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Your profile" })[0]).toHaveAttribute("title", "Grace"));
    // Grace's workspace opens its own socket to the room.
    await waitFor(() => expect(RoomSocket.all).toHaveLength(2));
  });

  it("forgets the session earlier versions kept in localStorage", async () => {
    localStorage.setItem("ember:session", JSON.stringify({ user: ada, token: "t" }));
    serve({ signedIn: false });
    render(<App />);
    await signInCard();
    expect(localStorage.getItem("ember:session")).toBeNull();
  });
});

describe(feature("auth.guest-sign-in"), () => {
  it("goes from the sign-in card to the workspace", async () => {
    serve({ signedIn: false });
    render(<App />);
    await userEvent.type(await screen.findByLabelText("Your name"), "Ada{Enter}");
    expect(await roomHeading()).toBeInTheDocument();
  });
});

describe(feature("auth.sign-out"), () => {
  it("ends the session and returns to the sign-in card", async () => {
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    await signOutFromTheRail();
    expect(await signInCard()).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" }));
  });

  it("stays signed in when signing out can't reach the server", async () => {
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await signOutFromTheRail();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" })));
    expect(screen.getByRole("heading", { level: 1, name: "general" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to Ember" })).not.toBeInTheDocument();
  });
});
