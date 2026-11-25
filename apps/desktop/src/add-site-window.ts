import { BrowserWindow, ipcMain, nativeTheme, session } from "electron";
import path from "node:path";
import { ADD_SITE, type AddSiteOutcome } from "./add-site-bridge.ts";
import { pageAddress, servePages } from "./app-pages.ts";

const PAGE = pageAddress("add-site.html");
const PRELOAD = path.join(import.meta.dirname, "preload", "add-site.cjs");

/**
 * The window that asks for a site's address, the one window the app opens on its first start, which
 * `add` adds the site from, opening its window. Its page can do nothing else.
 */
export class AddSiteWindow {
  #window: BrowserWindow | null = null;

  constructor(add: (typed: string) => Promise<AddSiteOutcome>) {
    servePages(session.defaultSession, ["add-site", "page", "ember-icon"]);
    ipcMain.handle(ADD_SITE, async (event, typed: unknown) => {
      const page = this.#window?.webContents;
      if (page === undefined || event.sender !== page || event.senderFrame?.url !== PAGE || typeof typed !== "string") throw new Error("Only the Add Site page adds sites");
      const outcome = await add(typed);
      if ("added" in outcome) this.#window?.close();
      return outcome;
    });
  }

  show(): void {
    this.#window ??= this.#open();
    this.#window.show();
    this.#window.focus();
  }

  #open(): BrowserWindow {
    const window = new BrowserWindow({
      width: 520,
      height: 600,
      useContentSize: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: "Add a Site",
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1c" : "#fafafa",
      webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => (this.#window = null));
    void window.loadURL(PAGE);
    return window;
  }
}
