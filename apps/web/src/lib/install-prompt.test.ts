import { feature } from "@ember/parity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canInstall, listenForInstallPrompt } from "./install-prompt";

// notification-help.test.tsx has Install now keep and use the browser's offer.

afterEach(() => {
  Reflect.deleteProperty(navigator, "serviceWorker");
  vi.unstubAllGlobals();
});

/** Whether the browser may make its own offer to install Ember, which Install now would have taken. */
function browserOffers() {
  const offer = new Event("beforeinstallprompt", { cancelable: true });
  dispatchEvent(offer);
  return !offer.defaultPrevented && !canInstall();
}

describe(feature("notifications.install-instructions"), () => {
  it("leaves the browser its own offer on a page without service workers, as Campfire does", () => {
    listenForInstallPrompt();
    expect(browserOffers()).toBe(true);
  });

  it("leaves the browser its own offer in the installed app", () => {
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    vi.stubGlobal("matchMedia", (media: string) => ({ matches: media === "(display-mode: standalone)", media }));
    listenForInstallPrompt();
    expect(browserOffers()).toBe(true);
  });
});
