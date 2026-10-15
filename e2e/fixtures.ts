import { test as base, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type WebSocketRoute } from "@playwright/test";
import { roomSocketQuery, type ClientFrame, type Invitation, type Message, type ServerFrame, type Sidebar, type User, type WorkspaceServerFrame } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext";

// Helpers every browser suite can share. They drive the real Worker and ChatRoom Durable Object
// that the config's webServer runs; nothing here mocks the backend except the room list.

/** A room's socket, for `page.routeWebSocket`. */
export const ROOM_SOCKET = /\/api\/rooms\/[^/]+\/socket/;
/** A tab's workspace socket, for `page.routeWebSocket`. */
export const WORKSPACE_SOCKET = /\/api\/socket$/;

/** Node's WebSocket, which, unlike a browser's, can send a handshake's headers. */
const NodeWebSocket = WebSocket as unknown as new (url: URL, init: { headers: Record<string, string> }) => WebSocket;

export interface Session {
  user: User;
  /** The session's cookie, ready for `BrowserContext.addCookies`. */
  cookie: { name: string; value: string; url: string; httpOnly: true; sameSite: "Lax" };
}

export interface TestRoom {
  id: string;
  name: string;
}

/** Signs someone in through the API, as the sign-in form does. */
export async function createSession(request: APIRequestContext, name: string): Promise<Session> {
  const response = await request.post("/api/session", { data: { name } });
  expect(response.status(), await response.text()).toBe(201);
  const { user } = (await response.json()) as { user: User };
  const [pair] = response.headers()["set-cookie"]!.split(";");
  const [cookieName, value] = pair!.split("=") as [string, string];
  return { user, cookie: { name: cookieName, value, url: new URL(response.url()).origin, httpOnly: true, sameSite: "Lax" } };
}

/** The administrator the first-run project sets Ember up with, whom every other suite can sign in as. */
export const ADMINISTRATOR = { name: "Ada Lovelace", emailAddress: "ada@example.com", password: "correct horse battery" };

/**
 * Gives `page` an IP address of its own, as Cloudflare's `CF-Connecting-IP` header, which `wrangler
 * dev` passes through, so the per-address limit on signing in never counts another test's attempts.
 */
export async function useOwnAddress(page: Page): Promise<void> {
  const groups = Array.from(crypto.getRandomValues(new Uint16Array(4)), (group) => group.toString(16));
  await page.setExtraHTTPHeaders({ "CF-Connecting-IP": `2001:db8::${groups.join(":")}` });
}

/** Signs the administrator in on the sign-in page `page` is showing, with `password` if given. */
export async function signInAsAdministrator(page: Page, password = ADMINISTRATOR.password): Promise<void> {
  await page.getByLabel("Email address").fill(ADMINISTRATOR.emailAddress);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Logs out as ember-rust does: from your profile, which the rail's avatar links to. */
export async function logOut(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Your profile" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
}

/** The `Cookie` header that carries a session, for clients other than the test's browsers. */
export const cookieHeader = ({ cookie }: Session) => `${cookie.name}=${cookie.value}`;

/** Starts the app already signed in, by giving the browser the session's cookie. */
export async function signInAs(page: Page, session: Session): Promise<void> {
  await page.context().addCookies([session.cookie]);
}

/** Creates an open room through the API as `session`'s person. Everyone is in it, whenever they sign in. */
export async function createRoom(request: APIRequestContext, session: Session, name: string): Promise<TestRoom> {
  const response = await request.post("/api/rooms", { data: { kind: "open", name }, headers: { Cookie: cookieHeader(session) } });
  expect(response.status(), await response.text()).toBe(201);
  const { room } = (await response.json()) as { room: TestRoom };
  return { id: room.id, name: room.name };
}

/**
 * Connects a tab's routed workspace socket to the server, passing on to the page what the server sends
 * when `passes` says so, and returns the server's end.
 */
export function connectWorkspace(ws: WebSocketRoute, passes: (frame: WorkspaceServerFrame) => boolean): WebSocketRoute {
  const server = ws.connectToServer();
  server.onMessage((message) => {
    if (passes(JSON.parse(String(message)) as WorkspaceServerFrame)) ws.send(message);
  });
  return server;
}

/**
 * Whether the workspace socket of a tab that lists just `roomIds` passes `frame` on: all but the rooms
 * saved that aren't among them, as the socket brings each room saved to everyone in it, and everyone's
 * in the rooms every other test opens to all. DMs pass, since only the test's own people are in them.
 */
export function listing(roomIds: Iterable<string>): (frame: WorkspaceServerFrame) => boolean {
  const listed = new Set(roomIds);
  return (frame) => frame.type !== "room.saved" || frame.room.kind === "direct" || listed.has(frame.room.id);
}

/** Keeps the rooms every other test saves out of the sidebars of `target`'s tabs, which list just `roomIds`. */
export async function keepOtherRoomsOut(target: Page | BrowserContext, roomIds: Iterable<string>): Promise<void> {
  const passes = listing(roomIds);
  await target.routeWebSocket(WORKSPACE_SOCKET, (ws) => void connectWorkspace(ws, passes));
}

/**
 * Makes `room` the only room in this page's sidebar, with nobody suggested for DMs, so the test starts
 * in an empty room of its own instead of among every other test's open rooms and oldest people. Given a `joinCode`, it's the room with the
 * welcome card too, inviting people with that code.
 */
export async function isolateRoom(page: Page, room: TestRoom, { joinCode }: { joinCode?: string } = {}): Promise<void> {
  const invitation = joinCode === undefined ? null : { roomId: room.id, joinCode };
  await page.route("**/api/sidebar", (route) =>
    route.fulfill({ json: { rooms: [{ ...room, kind: "open", icon: null, unread: false }], favorites: { rooms: [], version: 0 }, invitation, suggestions: [] } satisfies Sidebar }),
  );
  await keepOtherRoomsOut(page, [room.id]);
}

/**
 * The welcome card's invitation: the workspace's first room, the general that setup made, which every
 * open room's member is in, and the join code. Anyone in that room gets it with their rooms.
 */
export async function invitation(request: APIRequestContext, session: Session): Promise<Invitation> {
  const response = await request.get("/api/sidebar", { headers: { Cookie: cookieHeader(session) } });
  expect(response.status(), await response.text()).toBe(200);
  const { invitation } = (await response.json()) as Sidebar;
  expect(invitation, "Everyone is in general, where the welcome card is").not.toBeNull();
  return invitation!;
}

/** Opens a room and waits until its socket has connected and the history has loaded. */
export async function openRoom(page: Page, room: TestRoom): Promise<void> {
  await page.goto(`/rooms/${room.id}`);
  const timeline = page.getByRole("log", { name: `Messages in ${room.name}` });
  await expect(timeline).toBeVisible();
  await expect(timeline).not.toHaveAttribute("aria-busy");
}

/**
 * Opens `room` on a browser of the administrator's own, signing in on the way, and waits until its
 * history has loaded. Close its context afterwards.
 */
export async function administratorOn(browser: Browser, baseURL: string, room: TestRoom): Promise<Page> {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await useOwnAddress(page);
  await page.goto(`/rooms/${room.id}`);
  await signInAsAdministrator(page);
  await expect(page.getByRole("log", { name: `Messages in ${room.name}` })).not.toHaveAttribute("aria-busy");
  return page;
}

/**
 * A message editor's text box, such as the composer's ("Write a message"), once Lexical has taken it
 * over. Lexxy shows the box a frame before then, and Lexical empties it as it takes over, so anything
 * typed into it sooner is lost.
 */
export function editorField(scope: Page | Locator, name: string): Locator {
  return scope.getByRole("textbox", { name }).and(scope.locator("[data-lexical-editor]"));
}

/**
 * Another person in a room, connected over a real WebSocket from the test runner. Use it to
 * seed messages and presence without driving a second browser.
 */
export class Participant {
  private waiters = new Set<(frame: ServerFrame) => boolean>();

  private constructor(
    readonly session: Session,
    private readonly socket: WebSocket,
  ) {
    socket.addEventListener("message", (event) => {
      const frame = JSON.parse(String(event.data)) as ServerFrame;
      for (const waiter of this.waiters) if (waiter(frame)) this.waiters.delete(waiter);
    });
  }

  static async join(baseURL: string, session: Session, roomId: string): Promise<Participant> {
    const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/socket${roomSocketQuery({ visible: true })}`, baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    // The room only takes upgrades from the app's own pages, with a session cookie.
    const headers = { Cookie: cookieHeader(session), Origin: new URL(baseURL).origin };
    const participant = new Participant(session, new NodeWebSocket(url, { headers }));
    await participant.next((frame) => frame.type === "welcome");
    return participant;
  }

  /** Posts a message, sending its text as the composer does, and resolves once the room has stored it. */
  async say(text: string): Promise<Message> {
    const clientMessageId = crypto.randomUUID();
    const created = this.next((frame) => frame.type === "message.created" && frame.message.clientMessageId === clientMessageId);
    this.send({ type: "message.create", clientMessageId, body: bodyFromPlainText(text) });
    const frame = await created;
    return (frame as Extract<ServerFrame, { type: "message.created" }>).message;
  }

  /** Posts messages back to back, without waiting for each, and resolves once the room has stored them all, in order. */
  sayAll(texts: string[]): Promise<Message[]> {
    return Promise.all(texts.map((text) => this.say(text)));
  }

  /** Reacts to a message and resolves once the room has broadcast it. */
  async boost(messageId: string, content: string): Promise<void> {
    const created = this.next((frame) => frame.type === "boost.created" && frame.boost.messageId === messageId && frame.boost.content === content);
    this.send({ type: "boost.create", messageId, content });
    await created;
  }

  close(): void {
    this.socket.close(1000);
  }

  private send(frame: ClientFrame): void {
    this.socket.send(JSON.stringify(frame));
  }

  private next(match: (frame: ServerFrame) => boolean, timeout = 10_000): Promise<ServerFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${this.session.user.name} timed out waiting for a frame`));
      }, timeout);
      const waiter = (frame: ServerFrame) => {
        if (!match(frame)) return false;
        clearTimeout(timer);
        resolve(frame);
        return true;
      };
      this.waiters.add(waiter);
    });
  }
}

export interface AppFixtures {
  /** The signed-in user for this test. */
  session: Session;
  /** A room only this test uses, and the only one in its sidebar. */
  room: TestRoom;
  /** Connects someone else to the test's room. Disconnected when the test ends. */
  participant: (name: string) => Promise<Participant>;
}

export const test = base.extend<AppFixtures>({
  session: async ({ request }, use) => {
    await use(await createSession(request, "Test Person"));
  },
  room: async ({ page, request, session }, use) => {
    const room = await createRoom(request, session, "general");
    await isolateRoom(page, room);
    await use(room);
  },
  participant: async ({ request, room, baseURL }, use) => {
    const joined: Participant[] = [];
    await use(async (name) => {
      const participant = await Participant.join(baseURL!, await createSession(request, name), room.id);
      joined.push(participant);
      return participant;
    });
    for (const participant of joined) participant.close();
  },
});

export { expect };
