import { feature } from "@ember/parity";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloseCode, SIGN_IN_REFUSED, type Account, type AccountChanges } from "@ember/protocol";
import { flashOnNextPage } from "@/lib/flash";
import { loadPage } from "@/lib/page";
import { setPrefersDark } from "@/test-media";
import { App } from "./App";

vi.mock("@/lib/page", () => ({ loadPage: vi.fn() }));

const ada = { id: "u1", name: "Ada", administrator: true };
const grace = { id: "u2", name: "Grace", administrator: false };
const JOIN_CODE = "aB3d-Ef5h-iJ7k";
/** Where joining with Ada's email address sends the browser. */
const ADA_SIGNS_IN = "/session/new?email_address=ada%40example.com";
/** The workspace as it's set up. */
const EMBER: Account = { name: "Ember", hideTranslationButtons: true, customStyles: "" };
const general = { id: "general", name: "general", kind: "open", icon: null };
/** The rooms first run makes, general first. */
const firstRooms = [
  { id: "r1", name: "general", kind: "open", icon: null },
  { id: "r2", name: "random", kind: "open", icon: null },
];

class QuietSocket {
  static readonly OPEN = 1;
  readyState = 0;
  send() {}
  close() {}
}

/** A room socket the test answers as the room. The tab's workspace socket stays quiet, and unlisted. */
class RoomSocket extends QuietSocket {
  static all: RoomSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(url: string) {
    super();
    if (url.includes("/api/rooms/")) RoomSocket.all.push(this);
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

/** The tab's workspace socket, which the test answers as the Workspace. Room sockets stay quiet. */
class WorkspaceSocket extends QuietSocket {
  static all: WorkspaceSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string) {
    super();
    if (url.endsWith("/api/socket")) WorkspaceSocket.all.push(this);
  }

  receive(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  welcome(you: typeof ada, account = EMBER) {
    this.readyState = WorkspaceSocket.OPEN;
    this.onopen?.();
    this.receive({ type: "welcome", you, account });
  }
}

/**
 * Plays the server, which may be waiting to be set up, and whose session cookie this browser starts
 * out with or without. Ada, its administrator, signs in as ada@example.com with "correct horse", and
 * Grace joins.
 */
function serve({
  signedIn,
  setup = "complete",
  guestSignIn = true,
  account: given = EMBER,
}: {
  signedIn: boolean;
  setup?: "pending" | "complete";
  guestSignIn?: boolean;
  /** The workspace as it's set up, rather than `EMBER`. */
  account?: Account;
}) {
  let rooms = [general];
  let account = given;
  let me = ada;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const route = `${init?.method ?? "GET"} ${String(input)}`;
    if (route === "GET /api/bootstrap") {
      const helpContact = setup === "complete" ? { name: "Ada", emailAddress: "ada@example.com" } : null;
      return Response.json({ setup, setupProtected: false, guestSignIn, account, helpContact, version: "0.1", user: signedIn ? me : null });
    }
    if (route === "POST /api/first_run") {
      [setup, signedIn, rooms] = ["complete", true, firstRooms];
      return Response.json({ user: ada, room: firstRooms[0] }, { status: 201 });
    }
    if (route === "POST /api/session") {
      const fields = JSON.parse(String(init?.body)) as Record<string, string>;
      const isAda = fields.emailAddress === "ada@example.com" && fields.password === "correct horse";
      if (!("name" in fields) && !isAda) return Response.json({ error: SIGN_IN_REFUSED }, { status: 401 });
      [signedIn, me] = [true, ada];
      return Response.json({ user: ada }, { status: 201 });
    }
    if (route === "DELETE /api/session") {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    if (route === `POST /api/join/${JOIN_CODE}`) {
      const { emailAddress } = JSON.parse(String(init?.body)) as Record<string, string>;
      if (emailAddress === "ada@example.com") return Response.json({ error: "That email address has an account already", redirect: ADA_SIGNS_IN }, { status: 409 });
      [signedIn, me] = [true, grace];
      return Response.json({ user: grace }, { status: 201 });
    }
    if (!signedIn) return Response.json({ error: "Not signed in" }, { status: 401 });
    if (route === "GET /api/me") return Response.json({ user: me });
    if (route === "GET /api/account") return Response.json({ account, joinCode: JOIN_CODE, canAdminister: me.administrator });
    if (route === "GET /api/users") return Response.json({ users: [] });
    if (route === "PATCH /api/account") {
      const { name = account.name, settings } = JSON.parse(String(init?.body)) as AccountChanges;
      account = { ...account, name, hideTranslationButtons: settings?.hideTranslationButtons ?? account.hideTranslationButtons };
      return Response.json({ account });
    }
    return Response.json({ rooms, favorites: { rooms: [], version: 0 }, invitation: null });
  });
}

const roomHeading = () => screen.findByRole("heading", { level: 1, name: "general" });
/** The room page's first socket, which it opens just after it shows, so it may not exist yet when the page is found. */
async function roomSocket(): Promise<RoomSocket> {
  await waitFor(() => expect(RoomSocket.all).not.toHaveLength(0));
  return RoomSocket.all[0]!;
}
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

  it("sets up Ember at /first_run, then opens general signed in as its administrator", async () => {
    history.replaceState(null, "", "/first_run");
    serve({ signedIn: false, setup: "pending" });
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "correct horse{Enter}");

    expect(await screen.findByRole("heading", { level: 1, name: "general" })).toBeInTheDocument();
    expect(location.pathname).toBe("/rooms/r1");
    expect(screen.getAllByRole("button", { name: "Your profile" })[0]).toHaveAttribute("title", "Ada");
    expect(loadPage).not.toHaveBeenCalled();
  });

  it("leaves /first_run for the workspace once Ember is set up", async () => {
    history.replaceState(null, "", "/first_run");
    serve({ signedIn: true });
    render(<App />);
    expect(await roomHeading()).toBeInTheDocument();
    // Home, which goes on to the last room visited.
    expect(location.pathname).toBe("/rooms/general");
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
    const fetch = serve({ signedIn: true });
    render(<App />);
    await roomHeading();

    // Another tab joins as Grace, whose cookie reaches the room when this tab's socket reconnects.
    await fetch(`/api/join/${JOIN_CODE}`, { method: "POST", body: JSON.stringify({ emailAddress: "grace@example.com" }) });
    const socket = await roomSocket();
    act(() => socket.welcome(grace));
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
    const socket = await roomSocket();
    act(() => socket.welcome(ada));

    // Another tab signs out, and the room tells this tab's socket to reconnect.
    await fetch("/api/session", { method: "DELETE" });
    act(() => socket.end(CloseCode.Reconnect));
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith("/session/new"));
    expect(sessionStorage.getItem("ember:return-to")).toBe("/rooms/general");
  });
});

describe(feature("accounts.name"), () => {
  /** Serves signed in, as `serve` does, holding back its answer to `held`, such as "GET /api/account", until it's let go. */
  function serveHolding(held: string) {
    const server = serve({ signedIn: true });
    const answer = server.getMockImplementation()!;
    let letGo!: () => void;
    const goes = new Promise<void>((resolve) => (letGo = resolve));
    server.mockImplementation(async (input, init) => {
      if (`${init?.method ?? "GET"} ${String(input)}` === held) await goes;
      return answer(input, init);
    });
    return letGo;
  }

  it("takes a name saved in another tab at once, as the workspace socket says, on every page", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    act(() => WorkspaceSocket.all[0]!.welcome(ada));
    act(() => WorkspaceSocket.all[0]!.receive({ type: "account.updated", account: { ...EMBER, name: "Analytical Engines" } }));
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });

  it("renames the workspace from its settings, and the rail and sidebar take the new name", async () => {
    history.replaceState(null, "", "/account/edit");
    serve({ signedIn: true });
    render(<App />);
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Workspace name" });
    expect(name).toHaveValue("Ember");
    await user.clear(name);
    await user.type(name, "Analytical Engines{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved.");
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps a name the workspace socket says over settings asked for before it said so, which may be older", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    history.replaceState(null, "", "/account/edit");
    const sendSettings = serveHolding("GET /api/account");
    render(<App />);
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    act(() => WorkspaceSocket.all[0]!.welcome(ada));
    // Saved in another tab after the settings were read.
    act(() => WorkspaceSocket.all[0]!.receive({ type: "account.updated", account: { ...EMBER, name: "Analytical Engines" } }));
    sendSettings();

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveValue("Ember"));
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });

  it("keeps a name the workspace socket says over a save answered after it said so, which may be older", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    history.replaceState(null, "", "/account/edit");
    const answerSave = serveHolding("PATCH /api/account");
    render(<App />);
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    act(() => WorkspaceSocket.all[0]!.welcome(ada));
    const user = userEvent.setup();
    const name = await screen.findByRole("textbox", { name: "Workspace name" });
    await waitFor(() => expect(name).toHaveValue("Ember"));
    await user.clear(name);
    await user.type(name, "Difference Engines{Enter}");
    // Saved in another tab after this one's save.
    act(() => WorkspaceSocket.all[0]!.receive({ type: "account.updated", account: { ...EMBER, name: "Analytical Engines" } }));
    answerSave();

    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved.");
    expect(screen.getByRole("heading", { level: 2, name: "Analytical Engines" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ember home" })).toHaveAttribute("title", "Analytical Engines");
  });
});

describe(feature("accounts.custom-css"), () => {
  const RED = "body { color: red; }";
  const BLUE = "body { color: blue; }";
  /** The workspace's CSS, which comes after the app's own. */
  const customStyles = () => document.head.lastElementChild?.tagName === "STYLE" && document.head.lastElementChild.textContent;

  it("applies the workspace's CSS to every page, sign-in included", async () => {
    serve({ signedIn: false, account: { ...EMBER, customStyles: RED } });
    render(<App />);
    await signInPage();
    expect(customStyles()).toBe(RED);
  });

  it("applies CSS saved in another tab at once, as the workspace socket says, where ember-rust's tabs take it on their next load", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({ signedIn: true, account: { ...EMBER, customStyles: RED } });
    render(<App />);
    await roomHeading();
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    // Saved while the tab was without its socket.
    act(() => WorkspaceSocket.all[0]!.welcome(ada, { ...EMBER, customStyles: BLUE }));
    expect(customStyles()).toBe(BLUE);
    act(() => WorkspaceSocket.all[0]!.receive({ type: "account.updated", account: EMBER }));
    expect(customStyles()).toBe(false);
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
  });

  it("marks the page's body admin while an administrator is signed in, for the CSS to go by", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({ signedIn: true });
    const { unmount } = render(<App />);
    await roomHeading();
    expect(document.body).toHaveClass("admin");
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    act(() => WorkspaceSocket.all[0]!.welcome({ ...ada, administrator: false }));
    await waitFor(() => expect(document.body).not.toHaveClass("admin"));
    act(() => WorkspaceSocket.all[0]!.welcome(ada));
    await waitFor(() => expect(document.body).toHaveClass("admin"));
    unmount();
    expect(document.body).not.toHaveClass("admin");
  });
});

describe(feature("accounts.translation-buttons"), () => {
  it("shows translation buttons on sign-in once an administrator shows them", async () => {
    serve({ signedIn: false, account: { ...EMBER, hideTranslationButtons: false } });
    render(<App />);
    await signInPage();
    // By the email address and the password.
    expect(screen.getAllByText("Translate")).toHaveLength(2);
  });
});

describe(feature("accounts.roles"), () => {
  it("follows the person signed in being made a member, and an administrator again, as their rail says", async () => {
    WorkspaceSocket.all = [];
    vi.stubGlobal("WebSocket", WorkspaceSocket);
    serve({ signedIn: true });
    render(<App />);
    await roomHeading();
    expect(screen.getByRole("link", { name: "Admin" })).toBeInTheDocument();
    await waitFor(() => expect(WorkspaceSocket.all).toHaveLength(1));
    act(() => WorkspaceSocket.all[0]!.welcome(ada));

    const listed = { ...ada, bio: null, status: "active", avatarUrl: "/users/u1.token/avatar?v=20261014120000" };
    act(() => WorkspaceSocket.all[0]!.receive({ type: "user.updated", user: { ...listed, role: "member" } }));
    expect(await screen.findByRole("link", { name: "Workspace" })).toBeInTheDocument();
    act(() => WorkspaceSocket.all[0]!.receive({ type: "user.updated", user: { ...listed, role: "administrator" } }));
    expect(await screen.findByRole("link", { name: "Admin" })).toBeInTheDocument();
    // The same workspace, which only follows them.
    expect(WorkspaceSocket.all).toHaveLength(1);
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
    // Home, which goes on to the last room visited.
    expect(location.pathname).toBe("/rooms/general");
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
    // Home, which goes on to the last room visited.
    expect(location.pathname).toBe("/rooms/general");
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
    // Home, which goes on to the last room visited.
    expect(location.pathname).toBe("/rooms/general");
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
    const socket = await roomSocket();
    act(() => socket.welcome(ada));
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
    act(() => socket.end(CloseCode.Reconnect));
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

describe(feature("ui.appearance"), () => {
  it("keeps pages without the rail, such as sign-in, in step with other tabs and the device", async () => {
    serve({ signedIn: false });
    render(<App />);
    await signInPage();
    const isDark = () => document.documentElement.classList.contains("dark");

    localStorage.setItem("ember:appearance", "dark");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "ember:appearance", newValue: "dark" })));
    expect(isDark()).toBe(true);

    // Another tab clears the site's storage, which goes back to System.
    localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    expect(isDark()).toBe(false);
    act(() => setPrefersDark(true));
    expect(isDark()).toBe(true);
  });
});

describe(feature("ui.flash"), () => {
  const BESIDE_THE_RAIL = "md:left-[calc((100%+env(safe-area-inset-left)+var(--spacing-rail)+var(--spacing-sidebar))/2)]";
  /** Where the flash showing is placed. */
  const placement = async () => (await screen.findByRole("alert")).parentElement!;

  it("centers a flash over the window while signed out", async () => {
    serve({ signedIn: false });
    render(<App />);
    await signInAsAda("wrong horse");
    expect(await placement()).toHaveClass("left-1/2");
    expect(await placement()).not.toHaveClass(BESIDE_THE_RAIL);
  });

  it("centers a flash over the page beside the rail and sidebar in the workspace", async () => {
    history.replaceState(null, "", "/rooms/nowhere");
    serve({ signedIn: true });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Room not found or inaccessible");
    expect(await placement()).toHaveClass(BESIDE_THE_RAIL);
  });

  it("leaves a refused sign-in's alert behind once someone signs in", async () => {
    serve({ signedIn: false });
    render(<App />);
    await signInAsAda("wrong horse");
    await screen.findByRole("alert");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse{Enter}");
    expect(await roomHeading()).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("flashes what the page before a full page load kept for it once the page it's for shows", async () => {
    flashOnNextPage({ kind: "notice", text: "✓" });
    serve({ signedIn: true });
    render(<App />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await roomHeading()).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Changes saved");
    expect(await placement()).toHaveClass(BESIDE_THE_RAIL);
  });
});

describe(feature("ui.select-on-entry"), () => {
  it("selects what's in a field entered again on the sign-in page, signed out", async () => {
    serve({ signedIn: false });
    render(<App />);
    const user = userEvent.setup();
    const emailAddress = await screen.findByLabelText("Email address");
    await user.type(emailAddress, "grace@example.com");
    await user.click(screen.getByLabelText("Password"));
    await user.click(emailAddress);
    await user.keyboard("ada@example.com");
    expect(emailAddress).toHaveValue("ada@example.com");
  });

  it("leaves what's in Set up Ember's fields alone when they're entered", async () => {
    history.replaceState(null, "", "/first_run");
    serve({ signedIn: false, setup: "pending" });
    render(<App />);
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.type(name, "Ada");
    await user.click(screen.getByLabelText("Email address"));
    await user.click(name);
    await user.keyboard(" Lovelace");
    expect(name).toHaveValue("Ada Lovelace");
  });
});
