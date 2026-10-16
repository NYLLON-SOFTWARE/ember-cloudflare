// A browser's offer to install Ember as an app, which Campfire's pwa_install_controller.js keeps for
// Install now, and ember-rust with it. The browser makes it once a page load, perhaps before anything
// with Install now has shown, so the app listens for it from the start.

/** Chromium's `beforeinstallprompt`, which TypeScript's DOM types leave out. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function setOffer(event: InstallPromptEvent | null) {
  offer = event;
  for (const listener of listeners) listener();
}

/**
 * Keeps the browser's offer for Install now, in place of the browser's own, such as Chrome's banner on
 * Android, as Campfire does wherever there are service workers and Ember isn't installed already.
 */
export function listenForInstallPrompt(): void {
  if (!("serviceWorker" in navigator) || matchMedia("(display-mode: standalone)").matches) return;
  addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    setOffer(event as InstallPromptEvent);
  });
  addEventListener("appinstalled", () => setOffer(null));
}

/** Calls `listener` whenever the browser offers to install Ember, or stops offering. */
export function subscribeToInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the browser has offered to install Ember. */
export const canInstall = () => offer !== null;

/**
 * Shows the browser's prompt to install Ember. A prompt shows only once, so the offer goes with it,
 * until the browser makes another, where Campfire's Install now stays and does nothing when pressed again.
 */
export function promptInstall(): void {
  const prompt = offer;
  setOffer(null);
  prompt?.prompt().catch(() => {});
}
