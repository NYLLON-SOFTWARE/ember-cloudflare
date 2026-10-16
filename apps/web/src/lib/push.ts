// This browser's push subscription, which the app reaches through its service worker's registration,
// as ember-rust's pages do (crates/assets/overrides/controllers/notifications_controller.js, and
// reference/app/javascript/controllers/sessions_controller.js).

import type { PushSubscriptionKeys } from "@ember/protocol";
import { savePushSubscription } from "./api";

/** What the Notification setup dialog says when notifications aren't on, and whether it gives the setup help with it. */
export interface PushNotice {
  title: string;
  message: string;
  help: boolean;
}

const ALLOW_IN_SETTINGS = "Allow notifications for this site in your browser settings, then try again.";

/** ember-rust's notices, in its words. */
const NOTICES = {
  unavailable: {
    title: "Notifications aren’t available here",
    message: "Open Ember in a browser that supports notifications. On iPhone or iPad, add it to your Home Screen first.",
    help: true,
  },
  unconfigured: { title: "Notifications aren’t configured", message: "Ask your workspace administrator to configure Web Push on this server.", help: false },
  blocked: { title: "Notifications are blocked", message: ALLOW_IN_SETTINGS, help: true },
  denied: { title: "Notifications weren’t enabled", message: ALLOW_IN_SETTINGS, help: true },
  dismissed: {
    title: "Notifications weren’t enabled",
    message: "Choose Allow in the browser prompt to receive notifications. You can try again using the bell.",
    help: false,
  },
  failed: {
    title: "Couldn’t enable notifications",
    message: "Check your connection and try the bell again. Your room’s notification settings haven’t changed.",
    help: false,
  },
} satisfies Record<string, PushNotice>;

/** Whether this page can have push notifications at all: it's secure, and the browser has service workers, notifications and push. */
const pushAllowed = () => window.isSecureContext && "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;

/**
 * Whether this browser has notifications on, as ember-rust's bell decides each time it loads: they're
 * allowed and Web Push is on (`vapidPublicKey`), and the browser has a push subscription. The server
 * isn't asked whether it still has it. False when the browser can't say.
 */
export async function isPushOn(vapidPublicKey: string | null): Promise<boolean> {
  if (!pushAllowed() || !vapidPublicKey || Notification.permission !== "granted") return false;
  return (await pushSubscription().catch(() => null)) !== null;
}

/**
 * Turns notifications on as ember-rust's bell does, settling with why they aren't on, or null once
 * they are: it asks for permission, registers the service worker unless it's registered already, waits
 * for it to be active, subscribes, or keeps the subscription the browser already has, and saves that.
 * Call it from the click that asks, as Safari only prompts for permission then.
 */
export async function turnOnPush(vapidPublicKey: string | null): Promise<PushNotice | null> {
  if (!pushAllowed()) return NOTICES.unavailable;
  if (!vapidPublicKey) return NOTICES.unconfigured;
  if (Notification.permission === "denied") return NOTICES.blocked;
  try {
    // Before anything is awaited, so the click still counts.
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return permission === "denied" ? NOTICES.denied : NOTICES.dismissed;
    let registration = (await navigator.serviceWorker.getRegistration(location.origin)) ?? (await navigator.serviceWorker.register("/service-worker.js"));
    if (!registration.active) registration = await navigator.serviceWorker.ready;
    await subscribe(registration, vapidPublicKey);
    return null;
  } catch {
    return NOTICES.failed;
  }
}

/** Subscribes `registration` to pushes, unless it is already, and saves the subscription for you. */
async function subscribe(registration: ServiceWorkerRegistration, vapidPublicKey: string): Promise<void> {
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(vapidPublicKey) }));
  try {
    await savePushSubscription(keysOf(subscription));
  } catch (error) {
    // Kept, a new subscription the server doesn't have would pass for notifications being on.
    if (!existing) await subscription.unsubscribe().catch(() => false);
    throw error;
  }
}

/** What the server saves of `subscription`, from `toJSON()`, as ember-rust's bell sends it. */
function keysOf(subscription: PushSubscription): PushSubscriptionKeys {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("The browser's push subscription has no endpoint or keys");
  return { endpoint, p256dhKey: keys.p256dh, authKey: keys.auth };
}

/** The bytes of a key in URL-safe Base64, as the server gives it and `subscribe` takes it. */
function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const standard = base64.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "=")), (character) => character.charCodeAt(0));
}

const endingListeners = new Set<() => void>();

/** Calls `listener` whenever `unsubscribeFromPush` ends this browser's push subscription. */
export function subscribeToPushEnding(listener: () => void): () => void {
  endingListeners.add(listener);
  return () => endingListeners.delete(listener);
}

/**
 * Ends this browser's push subscription, as ember-rust's Log out does before it signs out, answering its
 * endpoint so that signing out forgets it on the server too. Null when there's none, or the browser has
 * no push at all.
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await pushSubscription().catch(() => null);
  if (!subscription) return null;
  // The server forgets it even if the browser can't end it, where ember-rust doesn't sign out at all.
  if (await subscription.unsubscribe().catch(() => false)) for (const listener of endingListeners) listener();
  return subscription.endpoint;
}

async function pushSubscription(): Promise<PushSubscription | null> {
  // Only secure pages have service workers, and only some browsers' have push.
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(location.origin);
  return (await registration?.pushManager?.getSubscription()) ?? null;
}
