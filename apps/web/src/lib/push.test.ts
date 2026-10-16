import { feature } from "@ember/parity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unsubscribeFromPush } from "./push";

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
