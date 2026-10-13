import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { ClientFrame, Message, ServerFrame, User } from "@ember/protocol";

// Helpers every browser suite can share. They drive the real Worker and ChatRoom Durable Object
// that the config's webServer runs; nothing here mocks the backend except the room list.

export interface Session {
  user: User;
  token: string;
}

export interface TestRoom {
  id: string;
  name: string;
}

/** Signs a user up through the API, as the sign-in form does. */
export async function createSession(request: APIRequestContext, name: string): Promise<Session> {
  const response = await request.post("/api/session", { data: { name } });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Session;
}

/** Starts the app already signed in, by storing the session where the app looks for it. */
export async function signInAs(page: Page, session: Session): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem("ember:session", value), JSON.stringify(session));
}

/** A room slug no other test uses. The Worker opens a fresh ChatRoom for any valid slug. */
export function uniqueRoomId(): string {
  return `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Makes `room` the only room in this page's sidebar, so the test starts in an empty room of its
 * own instead of sharing #general with every other test.
 */
export async function isolateRoom(page: Page, room: TestRoom): Promise<void> {
  await page.route("**/api/rooms", (route) => route.fulfill({ json: { rooms: [{ ...room, kind: "open" }] } }));
}

/** Opens a room and waits until its socket has connected and the history has loaded. */
export async function openRoom(page: Page, room: TestRoom): Promise<void> {
  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole("log", { name: `Messages in ${room.name}` })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
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
    const url = new URL(`/api/rooms/${encodeURIComponent(roomId)}/socket`, baseURL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", session.token);
    const participant = new Participant(session, new WebSocket(url));
    await participant.next((frame) => frame.type === "welcome");
    return participant;
  }

  /** Posts a message and resolves once the room has stored it. */
  async say(body: string): Promise<Message> {
    const clientMessageId = crypto.randomUUID();
    const created = this.next((frame) => frame.type === "message.created" && frame.message.clientMessageId === clientMessageId);
    this.send({ type: "message.create", clientMessageId, body });
    const frame = await created;
    return (frame as Extract<ServerFrame, { type: "message.created" }>).message;
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
  room: async ({ page }, use) => {
    const room = { id: uniqueRoomId(), name: "general" };
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
