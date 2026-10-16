// This browser's push subscription, which the app reaches through its service worker's registration,
// as ember-rust's pages do (reference/app/javascript/controllers/sessions_controller.js).

/**
 * Ends this browser's push subscription, as ember-rust's Log out does before it signs out, answering its
 * endpoint so that signing out forgets it on the server too. Null when there's none, or the browser has
 * no push at all.
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await pushSubscription().catch(() => null);
  if (!subscription) return null;
  // The server forgets it even if the browser can't end it, where ember-rust doesn't sign out at all.
  await subscription.unsubscribe().catch(() => false);
  return subscription.endpoint;
}

async function pushSubscription(): Promise<PushSubscription | null> {
  // Only secure pages have service workers, and only some browsers' have push.
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration(location.origin);
  return (await registration?.pushManager?.getSubscription()) ?? null;
}
