import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Electron's app, theme and windows, as far as the icon goes: a window keeps the file its icon came from. */
const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWindow {
    icon: string | null = null;
    setIcon(image: { file: string }) {
      this.icon = image.file;
    }
  }
  return { FakeWindow, app: new EventEmitter(), nativeTheme: Object.assign(new EventEmitter(), { shouldUseDarkColors: false }), windows: [] as FakeWindow[] };
});

vi.mock("electron", () => ({
  app: electron.app,
  nativeTheme: electron.nativeTheme,
  BrowserWindow: { getAllWindows: () => electron.windows },
  nativeImage: { createFromPath: (file: string) => ({ file }) },
}));

const { followAppearance } = await import("./app-icon.ts");

const icon = (appearance: "light" | "dark") => path.join(import.meta.dirname, "icons", `app-icon-${appearance}.png`);

/** Opens a window, as Electron tells the app it has. */
function open() {
  const window = new electron.FakeWindow();
  electron.windows.push(window);
  electron.app.emit("browser-window-created", {}, window);
  return window;
}

/** Turns the system's appearance dark or light, as Electron tells the app it has. */
function turn(dark: boolean) {
  electron.nativeTheme.shouldUseDarkColors = dark;
  electron.nativeTheme.emit("updated");
}

describe("The windows' icon", () => {
  beforeEach(() => {
    electron.app.removeAllListeners();
    electron.nativeTheme.removeAllListeners();
    electron.nativeTheme.shouldUseDarkColors = false;
    electron.windows.length = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("is the app's icon in the system's appearance, changing in every window as it does, on Windows and Linux", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    expect([icon("light"), icon("dark")].filter((file) => !fs.existsSync(file))).toEqual([]);
    followAppearance();
    const first = open();
    expect(first.icon).toBe(icon("light"));
    turn(true);
    expect(first.icon).toBe(icon("dark"));
    const second = open();
    expect(second.icon).toBe(icon("dark"));
    turn(false);
    expect([first.icon, second.icon]).toEqual([icon("light"), icon("light")]);
  });

  it("is left to macOS on a Mac, which draws the app's icon in each appearance itself", () => {
    vi.stubGlobal("process", { ...process, platform: "darwin" });
    followAppearance();
    const window = open();
    turn(true);
    expect(window.icon).toBeNull();
  });
});
