import { describe, expect, it } from "vitest";
import { mayUse } from "./permissions.ts";

const SITE = "https://chat.example.com";

describe("mayUse", () => {
  it("lets the site's own pages use the camera, microphone and speakers, notifications and copying", () => {
    for (const permission of ["media", "speaker-selection", "screen-wake-lock", "fullscreen", "notifications", "clipboard-sanitized-write"]) {
      expect(mayUse(permission, SITE, SITE)).toBe(true);
      // As Electron gives an origin when it asks, and the page's address when it's asked.
      expect(mayUse(permission, `${SITE}/`, SITE)).toBe(true);
      expect(mayUse(permission, `${SITE}/rooms/1`, SITE)).toBe(true);
    }
  });

  it("refuses what Ember has no need of", () => {
    for (const permission of ["geolocation", "clipboard-read", "midi", "hid", "usb", "serial", "openExternal", "display-capture", "window-management", "unknown"]) {
      expect(mayUse(permission, SITE, SITE)).toBe(false);
    }
  });

  it("refuses every other origin, such as a frame's from elsewhere", () => {
    for (const origin of ["https://example.com", "http://chat.example.com", "https://chat.example.com:8443", "null", "", undefined]) {
      expect(mayUse("media", origin, SITE)).toBe(false);
    }
  });
});
