import { feature } from "@ember/parity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPushOn, turnOnPush, unsubscribeFromPush } from "./push";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

/** Gives the page service workers, its own registered as `registration`, as only secure pages have them. */
function registered(registration: unknown, getRegistration = vi.fn(async () => registration)) {
  Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration }, configurable: true });
  return getRegistration;
}

/** A registration whose push subscription is at ENDPOINT, ending as `unsubscribe` does. */
function subscribed(unsubscribe = vi.fn(async () => true)) {
  return { registration: { pushManager: { getSubscription: async () => ({ endpoint: ENDPOINT, unsubscribe }) } }, unsubscribe };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("notifications.subscriptions"), () => {
  it("ends this browser's push subscription, answering its endpoint", async () => {
    const { registration, unsubscribe } = subscribed();
    const getRegistration = registered(registration);
    expect(await unsubscribeFromPush()).toBe(ENDPOINT);
    expect(getRegistration).toHaveBeenCalledWith(location.origin);
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("answers the endpoint even when the browser can't end the subscription, so the server forgets it", async () => {
    registered(subscribed(vi.fn(() => Promise.reject(new DOMException("Failed", "AbortError")))).registration);
    expect(await unsubscribeFromPush()).toBe(ENDPOINT);
  });

  it.each([
    ["no subscription", { pushManager: { getSubscription: async () => null } }],
    ["no push", {}],
    ["no service worker", undefined],
  ])("answers null for a browser with %s", async (_, registration) => {
    registered(registration);
    expect(await unsubscribeFromPush()).toBeNull();
  });

  it("answers null for a page without service workers, or when the browser can't say", async () => {
    expect(await unsubscribeFromPush()).toBeNull();
    registered(undefined, vi.fn(() => Promise.reject(new DOMException("No", "SecurityError"))));
    expect(await unsubscribeFromPush()).toBeNull();
  });
});

/** A P-256 public key's bytes, and the key as the server gives it, in URL-safe Base64 with `-` and `_`. */
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 0xff - i));
const KEY = "BP79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eDf3t3c29rZ2NfW1dTT0tHQz87NzMvKycjHxsXEw8LBwL8";

/** A push subscription at ENDPOINT. */
function subscription() {
  return { endpoint: ENDPOINT, toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "BNcRdreA", auth: "tBHItJI5" } }), unsubscribe: vi.fn(async () => true) };
}

type Subscription = ReturnType<typeof subscription>;

/** A service worker's registration, subscribed as `existing` says, which subscribes as `subscribe` does. */
function registration({ existing = null, subscribe = async () => subscription() }: { existing?: Subscription | null; subscribe?: () => Promise<Subscription> } = {}) {
  return { active: {}, pushManager: { getSubscription: vi.fn(async () => existing), subscribe: vi.fn(subscribe) } };
}

type Registration = ReturnType<typeof registration>;

interface Browser {
  /** Whether the page may show notifications before it asks. */
  permission?: NotificationPermission;
  /** What the browser's prompt answers. */
  answer?: NotificationPermission;
  /** The service worker's registration, once it's registered. */
  registered?: Registration;
  /** The registration that registering the service worker makes, once it's active. */
  installed?: Registration;
}

/**
 * Makes the page one that can have push notifications, as a secure one in a browser with service
 * workers, notifications and push is.
 */
function pushable({ permission = "default", answer = "granted", registered, installed = registration() }: Browser = {}) {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("PushManager", class {});
  const requestPermission = vi.fn(async () => answer);
  vi.stubGlobal("Notification", { permission, requestPermission });
  const serviceWorker = {
    getRegistration: vi.fn(async (): Promise<Registration | undefined> => registered),
    // Its worker is still installing.
    register: vi.fn(async () => ({ ...installed, active: null })),
    ready: Promise.resolve(installed),
  };
  Object.defineProperty(navigator, "serviceWorker", { value: serviceWorker, configurable: true });
  return { requestPermission, serviceWorker };
}

const saving = () => vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

const FAILED = {
  title: "Couldn’t enable notifications",
  message: "Check your connection and try the bell again. Your room’s notification settings haven’t changed.",
  help: false,
};

describe(feature("notifications.enable"), () => {
  it("asks for permission before it awaits anything, as Safari only prompts from the click", () => {
    const { requestPermission } = pushable();
    saving();
    void turnOnPush(KEY);
    expect(requestPermission).toHaveBeenCalledOnce();
  });

  it("registers the service worker, waits for it, subscribes with the server's key and saves the subscription", async () => {
    const installed = registration();
    const { serviceWorker } = pushable({ installed });
    const fetch = saving();
    expect(await turnOnPush(KEY)).toBeNull();
    expect(serviceWorker.getRegistration).toHaveBeenCalledWith(location.origin);
    expect(serviceWorker.register).toHaveBeenCalledWith("/service-worker.js");
    expect(installed.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: KEY_BYTES });
    expect(fetch).toHaveBeenCalledWith(
      "/api/push-subscriptions",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ endpoint: ENDPOINT, p256dhKey: "BNcRdreA", authKey: "tBHItJI5" }) }),
    );
  });

  it("keeps the browser's service worker and subscription, saving it again, without asking when it may already", async () => {
    const existing = registration({ existing: subscription() });
    const { requestPermission, serviceWorker } = pushable({ permission: "granted", registered: existing });
    const fetch = saving();
    expect(await turnOnPush(KEY)).toBeNull();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(existing.pushManager.subscribe).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("ends a subscription it made that couldn't be saved, which would pass for notifications being on", async () => {
    const made = subscription();
    pushable({ installed: registration({ subscribe: async () => made }) });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "Endpoint is not a permitted push service" }, { status: 422 }));
    expect(await turnOnPush(KEY)).toEqual(FAILED);
    expect(made.unsubscribe).toHaveBeenCalled();
  });

  it("keeps the subscription the browser had when it can't be saved again", async () => {
    const existing = subscription();
    pushable({ permission: "granted", registered: registration({ existing }) });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await turnOnPush(KEY)).toEqual(FAILED);
    expect(existing.unsubscribe).not.toHaveBeenCalled();
  });

  it("says it couldn't when the browser can't subscribe", async () => {
    pushable({ installed: registration({ subscribe: () => Promise.reject(new DOMException("Registration failed - push service error", "AbortError")) }) });
    expect(await turnOnPush(KEY)).toEqual(FAILED);
  });

  it.each([
    ["denied", { title: "Notifications weren’t enabled", message: "Allow notifications for this site in your browser settings, then try again.", help: true }],
    [
      "default",
      { title: "Notifications weren’t enabled", message: "Choose Allow in the browser prompt to receive notifications. You can try again using the bell.", help: false },
    ],
  ] as const)("says why when the prompt answers %s, with help to allow them once they're denied", async (answer, notice) => {
    const { serviceWorker } = pushable({ answer });
    expect(await turnOnPush(KEY)).toEqual(notice);
    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it("says they're blocked, with help, without asking again", async () => {
    const { requestPermission } = pushable({ permission: "denied" });
    expect(await turnOnPush(KEY)).toEqual({ title: "Notifications are blocked", message: "Allow notifications for this site in your browser settings, then try again.", help: true });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("says they aren't configured while Web Push is off, without asking", async () => {
    const { requestPermission } = pushable();
    expect(await turnOnPush(null)).toEqual({ title: "Notifications aren’t configured", message: "Ask your workspace administrator to configure Web Push on this server.", help: false });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it.each([
    ["an insecure page", () => vi.stubGlobal("isSecureContext", false)],
    ["a browser without service workers", () => Reflect.deleteProperty(navigator, "serviceWorker")],
    ["a browser without notifications", () => Reflect.deleteProperty(globalThis, "Notification")],
    ["a browser without push", () => Reflect.deleteProperty(globalThis, "PushManager")],
  ])("says they aren't available on %s, with help", async (_, unavailable) => {
    pushable();
    unavailable();
    expect(await turnOnPush(KEY)).toEqual({
      title: "Notifications aren’t available here",
      message: "Open Ember in a browser that supports notifications. On iPhone or iPad, add it to your Home Screen first.",
      help: true,
    });
  });

  it("finds them on where they're allowed, Web Push is on and the browser has a subscription, without asking the server", async () => {
    pushable({ permission: "granted", registered: registration({ existing: subscription() }) });
    const fetch = vi.spyOn(globalThis, "fetch");
    expect(await isPushOn(KEY)).toBe(true);
    expect(await isPushOn(null)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<[string, Browser]>([
    ["no subscription", { permission: "granted", registered: registration() }],
    ["no service worker registered", { permission: "granted" }],
    ["no permission yet", { permission: "default", registered: registration({ existing: subscription() }) }],
  ])("finds them off with %s", async (_, browser) => {
    pushable(browser);
    expect(await isPushOn(KEY)).toBe(false);
  });

  it("finds them off on an insecure page, or when the browser can't say", async () => {
    const { serviceWorker } = pushable({ permission: "granted", registered: registration({ existing: subscription() }) });
    serviceWorker.getRegistration.mockRejectedValue(new DOMException("No", "SecurityError"));
    expect(await isPushOn(KEY)).toBe(false);
    vi.stubGlobal("isSecureContext", false);
    expect(await isPushOn(KEY)).toBe(false);
  });
});
