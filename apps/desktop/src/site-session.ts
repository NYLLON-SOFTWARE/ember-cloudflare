import { app, dialog, session, shell, systemPreferences, type DownloadItem, type Event, type Session } from "electron";
import path from "node:path";
import { servePages } from "./app-pages.ts";
import { mayUse } from "./permissions.ts";

// Each site's window keeps its sign-in, storage and permissions in a session of its own, on disk, apart
// from every other site's, as a browser profile would.

const sessions = new Map<string, Session>();

const partitionOf = (id: string) => `persist:site-${id}`;

/** The session of the site with `id`, whose address `addressOf` gives as it is now. */
export function sessionOf(id: string, addressOf: () => string): Session {
  let siteSession = sessions.get(id);
  if (siteSession === undefined) {
    siteSession = session.fromPartition(partitionOf(id));
    grantOnly(siteSession, addressOf);
    siteSession.on("will-download", askWhereToSave);
    servePages(siteSession, ["unreachable", "page", "ember-icon"]);
    sessions.set(id, siteSession);
  }
  return siteSession;
}

/** The forgetting of sites' sessions under way, which the app finishes before it quits. */
const forgetting = new Set<Promise<void>>();

/** Forgets the site with `id`'s sign-in, storage and cache, which the app finishes before it quits (`stillForgetting`). */
export async function forgetSession(id: string): Promise<void> {
  sessions.delete(id);
  const forgotten = session.fromPartition(partitionOf(id)).clearData();
  forgetting.add(forgotten);
  try {
    await forgotten;
  } finally {
    forgetting.delete(forgotten);
  }
}

/** Settles once the sessions being forgotten are, or null while none is. */
export const stillForgetting = (): Promise<unknown> | null => (forgetting.size === 0 ? null : Promise.allSettled(forgetting));

/**
 * Lets the site's own pages use what `mayUse` allows, and nothing else, asking macOS first for the camera
 * and microphone, which it asks the person about once for the app.
 */
function grantOnly(siteSession: Session, addressOf: () => string): void {
  siteSession.setPermissionRequestHandler((_contents, permission, grant, details) => {
    if (!mayUse(permission, details.requestingUrl, addressOf())) return grant(false);
    if (permission === "media" && process.platform === "darwin" && "mediaTypes" in details) return void macOSAllows(details.mediaTypes ?? []).then(grant);
    grant(true);
  });
  siteSession.setPermissionCheckHandler((_contents, permission, origin) => mayUse(permission, origin, addressOf()));
  siteSession.setDevicePermissionHandler(() => false);
}

/** The devices macOS has said the app can't use, which it has told the person of once. */
const refusedDevices = new Set<string>();

/** Whether macOS lets the app use the camera or microphone that `kinds` name, asking the person the first time. */
async function macOSAllows(kinds: readonly ("video" | "audio")[]): Promise<boolean> {
  for (const device of kinds.map((kind) => (kind === "video" ? "camera" : "microphone"))) {
    if (await systemPreferences.askForMediaAccess(device)) continue;
    if (!refusedDevices.has(device)) void showWhereToAllow(device);
    refusedDevices.add(device);
    return false;
  }
  return true;
}

/** Tells the person the app can't use `device`, and where in System Settings to let it. */
async function showWhereToAllow(device: "camera" | "microphone"): Promise<void> {
  const pane = device === "camera" ? "Camera" : "Microphone";
  const { response } = await dialog.showMessageBox({
    type: "info",
    message: `Ember can't use your ${device}`,
    detail: `To use it in huddles, turn on Ember in System Settings, under Privacy & Security, then ${pane}.`,
    buttons: ["Open System Settings", "Not Now"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?Privacy_${pane}`);
}

/** Asks where to save each download, in the Downloads folder to start with, and shows it in a Mac's Dock once it's saved. */
function askWhereToSave(_event: Event, item: DownloadItem): void {
  item.setSaveDialogOptions({ defaultPath: path.join(app.getPath("downloads"), item.getFilename()) });
  item.once("done", (_done, state) => {
    if (state === "completed" && process.platform === "darwin") app.dock?.downloadFinished(item.getSavePath());
  });
}
