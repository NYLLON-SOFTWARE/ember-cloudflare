import type { BrowserContext, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { test as app, createRoom, createSession, expect, type Session, type TestRoom } from "../../fixtures";

export { expect };

/** The rooms each test has to itself. Its browsers show these instead of the server's own. */
export interface Rooms {
  general: TestRoom;
  random: TestRoom;
}

/**
 * Makes every page in `context` list just `rooms` of the server's rooms, since every other test's
 * open rooms take everyone in too. The server still answers first, so a session it refuses gets
 * its 401 as usual.
 */
async function showRooms(context: BrowserContext, rooms: Rooms): Promise<void> {
  const ids = new Set(Object.values(rooms).map((room) => room.id));
  await context.route("**/api/rooms", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const { rooms: listed } = (await response.json()) as { rooms: TestRoom[] };
    await route.fulfill({ response, json: { rooms: listed.filter((room) => ids.has(room.id)) } });
  });
}

/** One signed-in person with a browser of their own. */
export class Member {
  constructor(
    readonly page: Page,
    readonly session: Session,
  ) {}

  get name(): string {
    return this.session.user.name;
  }

  composer(): Locator {
    return this.page.getByRole("textbox", { name: /^Message #/ });
  }

  async send(text: string): Promise<void> {
    await this.composer().fill(text);
    await this.composer().press("Enter");
  }

  /** The message whose text includes `text`. */
  message(text: string): Locator {
    return this.page.getByRole("article").filter({ hasText: text });
  }

  /** The box for editing a message in place, while one is open. */
  editor(): Locator {
    return this.page.getByRole("textbox", { name: "Edit message" });
  }

  /** Shows a message's action bar by hovering it, and returns the bar. */
  async actions(text: string): Promise<Locator> {
    await this.message(text).hover();
    return this.message(text).getByRole("group", { name: "Message actions" });
  }

  /** The header's Connecting… or Reconnecting… badge, shown while the room's socket is down. */
  connection(): Locator {
    return this.page.getByRole("banner").getByRole("status");
  }

  /** Waits until the room's history has loaded and its socket is open. */
  async connected(): Promise<void> {
    await expect(this.page.getByRole("log", { name: /^Messages in / })).toBeVisible();
    await expect(this.connection()).toHaveCount(0);
  }

  presence(): Locator {
    return this.page.getByText(/^\d+ here now$/);
  }

  typingIndicator(): Locator {
    return this.page.locator("p[aria-live=polite]");
  }
}

export interface SignInOptions {
  /** Where to open the app: this test's #general by default. */
  path?: string;
  /** Options for this person's browser, such as a phone's viewport or a color scheme. */
  context?: BrowserContextOptions;
  /** Runs before the app loads, for instance to route the room socket. */
  beforeOpen?: (page: Page) => Promise<void>;
  /** Lists the server's rooms rather than this test's. */
  serverRooms?: boolean;
}

export interface Members {
  /** Signs `name` in with a browser context of their own and waits for the room to connect. */
  signIn(name: string, options?: SignInOptions): Promise<Member>;
}

export const test = app.extend<{ rooms: Rooms; members: Members }>({
  rooms: async ({ request, session }, use) => {
    await use({ general: await createRoom(request, session, "general"), random: await createRoom(request, session, "random") });
  },

  // The shared `room` is this test's #general, so `participant` posts where its members are.
  room: async ({ rooms }, use) => {
    await use(rooms.general);
  },

  // The default `page`, used by tests that start signed out, lists this test's rooms too.
  context: async ({ context, rooms }, use) => {
    await showRooms(context, rooms);
    await use(context);
  },

  members: async ({ browser, baseURL, request, rooms }, use) => {
    // Closing every context ends its sockets, so nobody lingers in a room after the test.
    const contexts: BrowserContext[] = [];
    await use({
      signIn: async (name, { path = `/rooms/${rooms.general.id}`, context: options, beforeOpen, serverRooms = false } = {}) => {
        const session = await createSession(request, name);
        // Given the cookie signing in gives a browser, so signing out and reloading stays signed out.
        const context = await browser.newContext({ baseURL, ...options });
        await context.addCookies([session.cookie]);
        contexts.push(context);
        if (!serverRooms) await showRooms(context, rooms);
        const page = await context.newPage();
        await beforeOpen?.(page);
        await page.goto(path);
        const member = new Member(page, session);
        await member.connected();
        return member;
      },
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});
