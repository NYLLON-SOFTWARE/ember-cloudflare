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
 * its 401 as usual, a page whose list is current gets its 304, and the welcome card's invitation is
 * the server's, for the general that setup made, which isn't listed.
 */
async function showRooms(context: BrowserContext, rooms: Rooms): Promise<void> {
  const ids = new Set(Object.values(rooms).map((room) => room.id));
  await context.route("**/api/sidebar", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const list = (await response.json()) as { rooms: TestRoom[] };
    await route.fulfill({ response, json: { ...list, rooms: list.rooms.filter((room) => ids.has(room.id)) } });
  });
}

/**
 * Lets a test end while its rooms list is still loading: closing the context mid-request would
 * otherwise fail the test with "Response has been disposed" or "Test ended" from `showRooms`.
 */
const stopShowingRooms = (context: BrowserContext) => context.unrouteAll({ behavior: "ignoreErrors" });

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

  /** The header's Connecting… or Reconnecting… badge, shown once the room's socket has been down 5 seconds. */
  connection(): Locator {
    return this.page.getByRole("navigation", { name: "Page" }).getByRole("status");
  }

  /** The room's messages, busy until the room lets its socket in. */
  timeline(): Locator {
    return this.page.getByRole("log", { name: /^Messages in / });
  }

  /** Waits until the room's history has loaded and its socket is open. */
  async connected(): Promise<void> {
    await expect(this.timeline()).toBeVisible();
    await expect(this.timeline()).not.toHaveAttribute("aria-busy");
  }

  presence(): Locator {
    return this.page.getByText(/^\d+ here now$/);
  }

  /** The names of whoever else is typing, above the composer: hidden and empty while nobody is. */
  typingIndicator(): Locator {
    return this.page.locator("footer").filter({ has: this.composer() }).locator(".spinner");
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
    await stopShowingRooms(context);
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
    await Promise.all(
      contexts.map(async (context) => {
        await stopShowingRooms(context);
        await context.close();
      }),
    );
  },
});
