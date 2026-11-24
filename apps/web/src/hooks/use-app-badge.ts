import { useEffect } from "react";
import { desktopApp } from "@/lib/desktop-app";

/**
 * Sets the app icon's badge to `count`, or clears it at 0, where the browser has app badges (an installed
 * app's does), as Campfire's badge_dot_controller.js does with the conversations its sidebar marks unread,
 * and in the desktop app, which counts it with its other sites' on its icon. Null, while the sidebar
 * loads, leaves the badge as a push may have set it.
 */
export function useAppBadge(count: number | null): void {
  useEffect(() => {
    if (count === null) return;
    const app = desktopApp();
    if (app) return app.setBadge(count);
    if (!("setAppBadge" in navigator)) return;
    // The Badging API lets a browser refuse, which leaves the badge as it was.
    (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
  }, [count]);
}
