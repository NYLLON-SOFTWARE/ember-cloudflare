import { feature } from "@ember/parity";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, SIGN_IN_REFUSED } from "@ember/protocol";
import { loadPage } from "@/lib/page";
import { App } from "./App";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

const ada = { id: "u1", name: "Ada" };
const grace = { id: "u2", name: "Grace" };
const JOIN_CODE = "aB3d-Ef5h-iJ7k";
/** Where joining with Ada's email address sends the browser. */
const ADA_SIGNS_IN = "/session/new?email_address=ada%40example.com";
const general = { id: "general", name: "general", kind: "open" };
const allTalk = { id: "r1", name: "All Talk", kind: "open" };

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
  onclose: ((event: { code: number }) => void) | null = null;

  constructor() {
    super();
    RoomSocket.all.push(this);
  }

  welcome(you: typeof ada) {
    this.readyState = RoomSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "welcome", you, messages: [], present: [you], hasMore: false }) });
  }

  /** The room closes the socket, saying why. */
  end(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

/**
 * Plays the server, which may be waiting to be set up, and whose session cookie this browser starts
 * out with or without. Ada signs in as ada@example.com with "correct horse".
 */
function serve({ signedIn, setup = "complete", guestSignIn = true }: { signedIn: boolean; setup?: "pending" | "complete"; guestSignIn?: boolean }) {
  let rooms = [general];
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const route = `${init?.method ?? "GET"} ${String(input)}`;
    if (route === "GET /api/bootstrap") {
      const helpContact = setup === "complete" ? { name: "Ada", emailAddress: "ada@example.com" } : null;
      return Response.json({ setup, setupProtected: false, guestSignIn, account: { name: "Ember" }, helpContact, version: "0.1", user: signedIn ? ada : null });
    }
    if (route === "POST /api/first_run") {
      [setup, signedIn, rooms] = ["complete", true, [allTalk]];
      return Response.json({ user: ada, room: allTalk }, { status: 201 });
    }
    if (route === "POST /api/session") {
      const fields = JSON.parse(String(init?.body)) as Record<string, string>;
      const isAda = fields.emailAddress === "ada@example.com" && fields.password === "correct horse";
      if (!("name" in fields) && !isAda) return Response.json({ error: SIGN_IN_REFUSED }, { status: 401 });
      signedIn = true;
      return Response.json({ user: ada }, { status: 201 });
    }
    if (route === "DELETE /api/session") {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    if (route === `POST /api/join/${JOIN_CODE}`) {
      const { emailAddress } = JSON.parse(String(init?.body)) as Record<string, string>;
      if (emailAddress === "ada@example.com") return Response.json({ error: "That email address has an account already", redirect: ADA_SIGNS_IN }, { status: 409 });
      signedIn = true;
      return Response.json({ user: grace }, { status: 201 });
    }
    if (!signedIn) return Response.json({ error: "Not signed in" }, { status: 401 });
    if (route === "GET /api/me") return Response.json({ user: ada });
    return Response.json({ rooms, invitation: null });
  });
}

const roomHeading = () => screen.findByRole("heading", { level: 1, name: "general" });
const signInPage = () => screen.findByRole("heading", { name: "Sign in to Ember" });

async function signInAsAda(password = "correct horse") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email address"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), `${password}{Enter}`);
}

async function signOutFromTheRail() {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("button", { name: "Your profile" })[0]!);
  await user.click(screen.getByRole("menuitem", { name: "Log out" }));
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", QuietSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(loadPage).mockClear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});

describe(feature("auth.first-run"), () => {
  it("sends every page to Set up Ember until Ember is set up", async () => {
    history.replaceState(null, "", "/rooms/general");
    serve({ signedIn: false, setup: "pending" });
    render(<App />);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/first_run"));
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("sets up Ember at /first_run, then opens All Talk signed in as its administrator", async () => {
    history.replaceState(null, "", "/first_run");
    serve({ signedIn: false, setup: "pending" });
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "All Talk" })).toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/r1");
    expect(screen.getAllByRole("button", { name: "Your profile" })[0]).toHaveAttribute("title", "Ada");
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("leaves /first_run for the workspace once Ember is set up", async () => {
    history.replaceState(null, "", "/first_run");
    serve({ signedIn: true });
    render(<App />);
    expect(await roomHeading()).toBeInTheDocument();
    expect(location.pathname).toBe("/");
    expect(loadPage).not.toHaveBeenCalled();
  });
});

describe(feature("auth.sessions"), () => {
  it("opens straight into the workspace for someone already signed in", async () => {
    serve({ signedIn: true });
    render(<App />);
    expect(await roomHeading()).toBeInTheDocument();
  });

  it("sends someone who isn't signed in to sign in", async () => {
    history.replaceState(null, "", "/rooms/general");
    serve({ signedIn: false });
    render(<App />);
    expect(await signInPage()).toBeInTheDocument();
    expect(location.pathname).toBe("/session/new");
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("keeps asking who's signed in while the server can't be reached", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serve({ signedIn: true });
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<App />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Sign in to Ember" })).not.toBeInTheDocument();

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
    await signInPage();
    expect(localStorage.getItem("ember:session")).toBeNull();
  });

  it("goes to sign in when the session ends elsewhere, and comes back to this room afterwards", async () => {
    RoomSocket.all = [];
    vi.stubGlobal("WebSocket", RoomSocket);
    history.replaceState(null, "", "/rooms/general");
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    act(() => RoomSocket.all[0]!.welcome(ada));

    // Another tab signs out, and the room tells this tab's socket to reconnect.
    await fetch("/api/session", { method: "DELETE" });
    act(() => RoomSocket.all[0]!.end(CloseCode.Reconnect));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/session/new"));
    expect(sessionStorage.getItem("ember:return-to")).toBe("/rooms/general");
  });
});

describe(feature("auth.sign-in"), () => {
  it("signs in with an email address and password, and comes back to the page asked for", async () => {
    history.replaceState(null, "", "/rooms/general");
    serve({ signedIn: false });
    render(<App />);
    await signInPage();
    await signInAsAda();
    expect(await roomHeading()).toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/general");
  });

  it("goes home from the sign-in page itself", async () => {
    history.replaceState(null, "", "/session/new");
    serve({ signedIn: false });
    render(<App />);
    await signInAsAda();
    expect(await roomHeading()).toBeInTheDocument();
    expect(location.pathname).toBe("/");
  });

  it("shows the sign-in page to someone already signed in, as ember-rust does", async () => {
    history.replaceState(null, "", "/session/new");
    serve({ signedIn: true });
    render(<App />);
    expect(await signInPage()).toBeInTheDocument();
    await signInAsAda();
    expect(await roomHeading()).toBeInTheDocument();
  });

  it("stays on the sign-in page when the password is wrong", async () => {
    serve({ signedIn: false });
    render(<App />);
    await signInAsAda("wrong horse");
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_REFUSED);
    expect(screen.getByRole("heading", { name: "Sign in to Ember" })).toBeInTheDocument();
    expect(location.pathname).toBe("/session/new");
  });
});

describe(feature("auth.sign-up"), () => {
  const joinPage = () => screen.findByRole("heading", { name: "Join Ember" });

  async function join(emailAddress: string) {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Grace");
    await user.type(screen.getByLabelText("Email address"), emailAddress);
    await user.type(screen.getByLabelText("Password"), "compiler{Enter}");
  }

  it("opens the join page for a join link, and goes home signed in once the account is made", async () => {
    history.replaceState(null, "", `/join/${JOIN_CODE}`);
    serve({ signedIn: false });
    render(<App />);
    expect(await joinPage()).toBeInTheDocument();
    expect(location.pathname).toBe(`/join/${JOIN_CODE}`);

    await join("grace@example.com");
    expect(await roomHeading()).toBeInTheDocument();
    expect(location.pathname).toBe("/");
    expect(screen.getAllByRole("button", { name: "Your profile" })[0]).toHaveAttribute("title", "Grace");
  });

  it("sends an email address that has an account to sign in with it", async () => {
    history.replaceState(null, "", `/join/${JOIN_CODE}`);
    serve({ signedIn: false });
    render(<App />);
    await join("ada@example.com");
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith(ADA_SIGNS_IN));
  });

  it("sends someone who's signed in home from a join link, as ember-rust does", async () => {
    history.replaceState(null, "", `/join/${JOIN_CODE}`);
    serve({ signedIn: true });
    render(<App />);
    expect(await roomHeading()).toBeInTheDocument();
    expect(location.pathname).toBe("/");
  });
});

describe(feature("auth.guest-sign-in"), () => {
  it("goes from the sign-in page to the workspace with just a name", async () => {
    serve({ signedIn: false });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Join with just a name" }));
    await userEvent.type(screen.getByLabelText("Your name"), "Ada{Enter}");
    expect(await roomHeading()).toBeInTheDocument();
  });

  it("only offers the password when guests can't sign in", async () => {
    serve({ signedIn: false, guestSignIn: false });
    render(<App />);
    await signInPage();
    expect(screen.queryByRole("button", { name: "Join with just a name" })).not.toBeInTheDocument();
  });
});

describe(feature("auth.sign-out"), () => {
  it("ends the session and loads the sign-in page, from where signing in goes home", async () => {
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    sessionStorage.setItem("ember:return-to", "/rooms/general");
    await signOutFromTheRail();
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/session/new"));
    expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" }));
    expect(sessionStorage.getItem("ember:return-to")).toBeNull();
  });

  it("goes home after signing in again, even when a room closes the socket before signing out answers", async () => {
    RoomSocket.all = [];
    vi.stubGlobal("WebSocket", RoomSocket);
    history.replaceState(null, "", "/rooms/general");
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    act(() => RoomSocket.all[0]!.welcome(ada));
    // The server ends the session at once, but its answer is held back.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const server = fetch.getMockImplementation()!;
    fetch.mockImplementationOnce(async (input, init) => {
      const response = await server(input, init);
      await answered;
      return response;
    });

    await signOutFromTheRail();
    act(() => RoomSocket.all[0]!.end(CloseCode.Reconnect));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/me", expect.anything()));
    answer();
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/session/new"));
    expect(loadPage).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("ember:return-to")).toBeNull();
  });

  it("stays signed in when signing out can't reach the server", async () => {
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await signOutFromTheRail();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/session", expect.objectContaining({ method: "DELETE" })));
    expect(screen.getByRole("heading", { level: 1, name: "general" })).toBeInTheDocument();
    expect(loadPage).not.toHaveBeenCalled();
  });
});
