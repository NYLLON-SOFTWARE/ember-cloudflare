import { feature } from "@ember/parity";
import { CloseCode, type Sidebar, type SidebarRoom, type User, type WorkspaceServerFrame } from "@ember/protocol";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RELOAD_AFTER_HIDDEN_MS, useSidebar } from "./use-sidebar";

const ada: User = { id: "u1", name: "Ada" };
const grace: User = { id: "u2", name: "Grace" };
const design: SidebarRoom = { id: "r1", name: "Design", kind: "open", icon: null, unread: false };
const general: SidebarRoom = { id: "r2", name: "general", kind: "open", icon: null, unread: false };

/** Stands in for the browser's WebSocket; tests play the Workspace and the network. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static all: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  closedWith: number | undefined;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }

  send() {}

  close(code?: number) {
    this.closedWith = code;
    this.readyState = FakeSocket.CLOSED;
  }

  /** Opens, and lets the socket in with a welcome for `you`. */
  connect(you = ada) {
    act(() => {
      this.readyState = FakeSocket.OPEN;
      this.onopen?.();
    });
    this.receive({ type: "welcome", you });
  }

  receive(frame: WorkspaceServerFrame) {
    act(() => this.onmessage?.({ data: JSON.stringify(frame) }));
  }

  /** Closes as the network or the Workspace does: 1006 when the connection drops. */
  drop(code = 1006) {
    act(() => {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code });
    });
  }
}

/**
 * Plays the server: Ada's sidebar, with an ETag that changes with it, and who the session signs in.
 * While `held`, answers for the sidebar wait for it.
 */
const server = {
  sidebar: { rooms: [design], invitation: null } as Sidebar,
  version: 1,
  signedIn: ada as User | null,
  held: null as Promise<void> | null,
  change(sidebar: Sidebar) {
    this.sidebar = sidebar;
    this.version++;
  },
};

async function answer(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(input);
  if (path === "/api/me") return server.signedIn ? Response.json({ user: server.signedIn }) : Response.json({ error: "Not signed in" }, { status: 401 });
  if (path !== "/api/sidebar") throw new Error(`No answer for ${path}`);
  await server.held;
  if (!server.signedIn) return Response.json({ error: "Not signed in" }, { status: 401 });
  const etag = `W/"${server.version}"`;
  if (new Headers(init?.headers).get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return Response.json(server.sidebar, { headers: { ETag: etag } });
}

/** Holds the server's answers for the sidebar until the function it returns is called. */
function holdAnswers() {
  let release!: () => void;
  server.held = new Promise((resolve) => (release = resolve));
  return () => act(async () => release());
}

/** The ETag each request for the sidebar named, null for none, in order. */
const sidebarRequests = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input) === "/api/sidebar")
    .map(([, init]) => new Headers(init?.headers).get("If-None-Match"));

const socket = () => FakeSocket.all.at(-1)!;
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
/** Lets the requests under way be answered, and what they change render. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const visibility = (state: DocumentVisibilityState) =>
  act(() => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    document.dispatchEvent(new Event("visibilitychange"));
  });

/** Ada's sidebar, loaded. */
async function showSidebar(onSessionChanged: (me: User | null) => void = () => {}) {
  const hook = renderHook(() => useSidebar(ada, onSessionChanged));
  await settle();
  return hook;
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  Object.assign(server, { sidebar: { rooms: [design], invitation: null }, version: 1, signedIn: ada, held: null });
  vi.stubGlobal("fetch", vi.fn(answer));
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: back-off delays come out exact
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("sidebar.live-updates"), () => {
  it("loads, and loads again each time the workspace socket connects, the first time included", async () => {
    const { result } = await showSidebar();
    expect(result.current.list).toEqual({ rooms: [design], invitation: null });
    expect(socket().url).toBe("ws://localhost:3000/api/socket");

    server.change({ rooms: [design, general], invitation: null });
    socket().connect();
    await settle();
    expect(result.current.list?.rooms).toEqual([design, general]);

    server.change({ rooms: [general], invitation: null });
    socket().drop();
    await wait(500);
    socket().connect();
    await settle();
    expect(result.current.list?.rooms).toEqual([general]);
    expect(sidebarRequests()).toEqual([null, 'W/"1"', 'W/"2"']);
  });

  it("keeps the list it has while the server says it's current", async () => {
    const { result } = await showSidebar();
    const shown = result.current.list;
    socket().connect();
    await settle();
    expect(sidebarRequests()).toEqual([null, 'W/"1"']);
    expect(result.current.list).toBe(shown);
  });

  it("loads again once the tab is shown after more than a minute hidden", async () => {
    await showSidebar();
    await visibility("hidden");
    await wait(RELOAD_AFTER_HIDDEN_MS);
    await visibility("visible");
    await settle();
    expect(sidebarRequests()).toHaveLength(1);

    await visibility("hidden");
    await wait(RELOAD_AFTER_HIDDEN_MS + 1);
    await visibility("visible");
    await settle();
    expect(sidebarRequests()).toHaveLength(2);
  });

  it("counts a tab that loads hidden as hidden since it loaded", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await showSidebar();
    await wait(RELOAD_AFTER_HIDDEN_MS + 1);
    await visibility("visible");
    await settle();
    expect(sidebarRequests()).toHaveLength(2);
  });

  it("asks again once the list on its way comes, once however often it's asked for meanwhile", async () => {
    const { result } = await showSidebar();
    const release = holdAnswers();
    const asked = [result.current.refresh(), result.current.refresh(), result.current.refresh()];
    let settled = 0;
    asked.forEach((refresh) => void refresh.then(() => settled++));
    server.change({ rooms: [design, general], invitation: null });
    await release();
    await settle();
    expect(sidebarRequests()).toEqual([null, 'W/"1"', 'W/"2"']);
    expect(settled).toBe(3);
    expect(result.current.list?.rooms).toEqual([design, general]);
  });

  it("keeps a room saved here while a list is on its way that may not show it", async () => {
    const { result } = await showSidebar();
    const release = holdAnswers();
    socket().connect();
    act(() => result.current.change({ type: "saved", room: general }));
    await release();
    await settle();
    expect(result.current.list?.rooms).toEqual([design, general]);
  });
});

describe(feature("sidebar.unread"), () => {
  it("marks rooms unread and read as the workspace socket says", async () => {
    const { result } = await showSidebar();
    socket().connect();
    await settle();
    socket().receive({ type: "room.unread", roomId: design.id });
    expect(result.current.list?.rooms).toEqual([{ ...design, unread: true }]);
    socket().receive({ type: "room.read", roomId: design.id });
    expect(result.current.list?.rooms).toEqual([design]);
  });

  it("keeps a mark that comes while a list is on its way that may not show it", async () => {
    const { result } = await showSidebar();
    const release = holdAnswers();
    socket().connect();
    socket().receive({ type: "room.unread", roomId: design.id });
    await release();
    await settle();
    expect(result.current.list?.rooms).toEqual([{ ...design, unread: true }]);
  });
});

describe(feature("platform.live-socket"), () => {
  it("hands the tab over to whoever its socket's welcome says the session signs in", async () => {
    const onSessionChanged = vi.fn();
    await showSidebar(onSessionChanged);
    socket().connect(grace);
    expect(onSessionChanged).toHaveBeenCalledWith(grace);
    expect(socket().closedWith).toBe(1000);
    await settle();
    expect(sidebarRequests()).toHaveLength(1);
  });

  it("goes to sign in when the session has expired, found when the Workspace says to reconnect", async () => {
    const onSessionChanged = vi.fn();
    await showSidebar(onSessionChanged);
    socket().connect();
    server.signedIn = null;
    socket().drop(CloseCode.Reconnect);
    await settle();
    expect(onSessionChanged).toHaveBeenCalledWith(null);
  });

  it("asks whether the session has expired when the socket is refused, and connects again while it hasn't", async () => {
    const onSessionChanged = vi.fn();
    await showSidebar(onSessionChanged);
    socket().drop();
    await settle();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/me", expect.anything());
    expect(onSessionChanged).not.toHaveBeenCalled();
    await wait(500);
    expect(FakeSocket.all).toHaveLength(2);

    server.signedIn = null;
    socket().drop();
    await settle();
    expect(onSessionChanged).toHaveBeenCalledWith(null);
  });

  it("goes to sign in when the sidebar is refused for an expired session", async () => {
    server.signedIn = null;
    const onSessionChanged = vi.fn();
    await showSidebar(onSessionChanged);
    expect(onSessionChanged).toHaveBeenCalledWith(null);
  });

  it("closes its socket, and stops listening for the tab, once it's gone", async () => {
    const { unmount } = await showSidebar();
    unmount();
    expect(socket().closedWith).toBe(1000);
    await visibility("hidden");
    await wait(RELOAD_AFTER_HIDDEN_MS + 1);
    await visibility("visible");
    await settle();
    expect(sidebarRequests()).toHaveLength(1);
  });
});
