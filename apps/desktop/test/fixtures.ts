import { _electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Site } from "../src/sites.ts";

export { expect };

const DESKTOP = path.join(import.meta.dirname, "..");
/** Run ahead of the app, so that Playwright can't catch Node half loading a global it reads (the file says how). */
const LAZY_GLOBALS = path.join(import.meta.dirname, "load-lazy-globals.cjs");

/** The app, started with a folder of its own for its sites, as on a person's first start. */
export interface App {
  /** The app as it runs now. */
  readonly electron: ElectronApplication;
  /** Quits the app and starts it again with the same folder, as a person would. */
  restart(): Promise<void>;
  /** The sites the app keeps, as it last wrote them. */
  sites(): Site[];
  /** The addresses the app opened outside itself, in the person's browser or email app. */
  openedOutside(): Promise<string[]>;
  /** Adds the site at `address` through Add Site, which `addSite` shows, and returns the site's window. */
  add(addSite: Page, address: string): Promise<Page>;
  /** Clicks the item labelled `label` in the app's menu labelled `menu`. */
  clickMenu(menu: string, label: string): Promise<void>;
  /** Answers the app's next question in a message box with its button labelled `button`. */
  answer(button: string): Promise<void>;
  /** The titles of the app's windows, sorted: those showing, or every one running, out of sight or not. */
  titles(which: "showing" | "running"): Promise<string[]>;
  /** Closes the window titled `title`, as a person would, until it's out of sight, as a site's own goes, or closed. */
  close(title: string): Promise<void>;
}

export const test = base.extend<{ app: App }>({
  app: async ({}, use) => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ember-desktop-"));
    let electron = await launch(folder);
    await use({
      get electron() {
        return electron;
      },
      async restart() {
        await electron.close();
        electron = await launch(folder);
      },
      sites: () => (JSON.parse(fs.readFileSync(path.join(folder, "sites.json"), "utf8")) as { sites: Site[] }).sites,
      openedOutside: () => electron.evaluate(() => (globalThis as { openedOutside?: string[] }).openedOutside ?? []),
      async add(addSite, address) {
        await addSite.getByLabel("Site address").fill(address);
        const [window] = await Promise.all([electron.waitForEvent("window"), addSite.getByRole("button", { name: "Add site" }).click()]);
        await window.waitForLoadState("domcontentloaded");
        return window;
      },
      clickMenu: (menu, label) =>
        electron.evaluate(({ Menu }, [menu, label]) => {
          const item = Menu.getApplicationMenu()
            ?.items.find((item) => item.label === menu)
            ?.submenu?.items.find((item) => item.label === label);
          if (!item) throw new Error(`No ${label} in ${menu}`);
          item.click();
        }, [menu, label] as const),
      answer: (button) =>
        electron.evaluate(({ dialog }, button) => {
          const choose = (options: Electron.MessageBoxOptions) => Math.max(0, options.buttons?.indexOf(button) ?? 0);
          dialog.showMessageBox = (async (...args: unknown[]) => ({ response: choose(args.at(-1) as Electron.MessageBoxOptions), checkboxChecked: false })) as typeof dialog.showMessageBox;
          dialog.showMessageBoxSync = ((...args: unknown[]) => choose(args.at(-1) as Electron.MessageBoxOptions)) as typeof dialog.showMessageBoxSync;
        }, button),
      titles: (which) =>
        electron.evaluate(
          ({ BrowserWindow }, which) =>
            BrowserWindow.getAllWindows()
              .filter((window) => which === "running" || window.isVisible() || window.isMinimized())
              .map((window) => window.getTitle())
              .sort(),
          which,
        ),
      close: (title) =>
        electron.evaluate(
          ({ BrowserWindow }, title) =>
            new Promise<void>((resolve, reject) => {
              const window = BrowserWindow.getAllWindows().find((window) => window.getTitle() === title);
              if (!window) return reject(new Error(`No window is titled ${title}`));
              window.once("hide", () => resolve());
              window.once("closed", () => resolve());
              window.close();
            }),
          title,
        ),
    });
    await electron.close();
    fs.rmSync(folder, { recursive: true, force: true });
  },
});

/**
 * Starts the app with its sites in `folder`, noting what it opens outside itself rather than opening it,
 * and answering yes for macOS when the app asks to use the camera and microphone, which would otherwise
 * ask whoever runs the tests, or wait for an answer on CI's Mac.
 */
async function launch(folder: string): Promise<ElectronApplication> {
  const electron = await _electron.launch({
    args: ["--use-fake-device-for-media-stream", "-r", LAZY_GLOBALS, DESKTOP],
    // Chromium's sandbox, which Playwright leaves off on Linux unless asked, runs as on people's computers,
    // but as root, as in a container, where it can't start.
    chromiumSandbox: process.getuid?.() !== 0,
    env: { ...process.env, EMBER_DESKTOP_USER_DATA: folder },
  });
  await electron.evaluate(({ shell, systemPreferences }) => {
    const opened: string[] = [];
    Object.assign(globalThis, { openedOutside: opened });
    shell.openExternal = async (url) => void opened.push(url);
    systemPreferences.askForMediaAccess = async () => true;
  });
  return electron;
}
