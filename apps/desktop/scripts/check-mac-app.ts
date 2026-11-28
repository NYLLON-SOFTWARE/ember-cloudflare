// Checks the Mac app that `pnpm package` made in release/: that each chip's app has a signature that
// holds, and that the one for this Mac's chip starts and shows Add Site, as it would on a first start.
// With --signed, also that each, and the one in each disk image, is signed with a Developer ID, with the
// hardened runtime, and notarized, its ticket stapled to it, so that macOS opens it as any app from the
// internet. The disk images themselves aren't signed, as electron-builder advises.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RELEASE = path.join(import.meta.dirname, "..", "release");
/** Where electron-builder puts each chip's app: Apple silicon's in mac-arm64/, Intel's in mac/. */
const APPS: Record<string, string> = {
  arm64: path.join(RELEASE, "mac-arm64", "Ember.app"),
  x64: path.join(RELEASE, "mac", "Ember.app"),
};
/** Add Site's page, as add-site-window.ts opens it, with the title it has once it's loaded. */
const ADD_SITE = { url: "ember-app://pages/add-site.html", title: "Add a Site" };
/** Where the starting app lists its pages, as Chromium's remote debugging does. */
const DEBUGGING_PORT = 9223;
/** How long the app may take to show Add Site: a first start waits on macOS checking the new app. */
const START_TIME = 90_000;

const signed = process.argv.includes("--signed");
for (const app of Object.values(APPS)) checkSignature(app, signed);
if (signed) for (const image of fs.readdirSync(RELEASE).filter((name) => name.endsWith(".dmg"))) checkDiskImage(path.join(RELEASE, image));
const ours = APPS[process.arch];
if (ours === undefined) throw new Error(`No Mac app is made for ${process.arch}`);
await checkStarts(ours);

/** Checks `app`'s signature holds, and with `developerId`, that it's a Developer ID's, with the hardened runtime, and notarized. */
function checkSignature(app: string, developerId: boolean): void {
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  if (developerId) {
    const signature = run("codesign", ["--display", "--verbose=2", app]);
    expect(signature, /^Authority=Developer ID Application: /m, `${app} isn't signed with a Developer ID`);
    expect(signature, /flags=0x[0-9a-f]+\([^)]*\bruntime\b/, `${app} isn't signed with the hardened runtime`);
    expect(run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]), /^source=Notarized Developer ID$/m, `${app} isn't notarized`);
    run("xcrun", ["stapler", "validate", app]);
    console.log(`${app} is signed with ${/^Authority=(.*)$/m.exec(signature)?.[1]}, notarized and stapled.`);
  } else {
    console.log(`${app}'s signature holds.`);
  }
}

/** Checks the app in the disk image at `image` is signed, notarized and stapled. */
function checkDiskImage(image: string): void {
  const mounted = fs.mkdtempSync(path.join(os.tmpdir(), "ember-dmg-"));
  run("hdiutil", ["attach", image, "-nobrowse", "-readonly", "-mountpoint", mounted]);
  try {
    checkSignature(path.join(mounted, "Ember.app"), true);
  } finally {
    run("hdiutil", ["detach", mounted]);
  }
}

/** Starts `app` with a folder of its own, as on a person's first start, and waits until it shows Add Site. */
async function checkStarts(app: string): Promise<void> {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ember-desktop-"));
  // A mock keychain, as the runner's keychain may be locked, which would ask for its password.
  const started = spawn(path.join(app, "Contents", "MacOS", "Ember"), [`--remote-debugging-port=${DEBUGGING_PORT}`, "--use-mock-keychain"], {
    env: { ...process.env, EMBER_DESKTOP_USER_DATA: userData },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let printed = "";
  started.stdout.on("data", (chunk) => (printed += chunk));
  started.stderr.on("data", (chunk) => (printed += chunk));
  const exited = new Promise<void>((resolve) => started.once("exit", () => resolve()));
  let running = true;
  void exited.then(() => (running = false));
  try {
    const deadline = Date.now() + START_TIME;
    while (!(await showsAddSite())) {
      if (!running) throw new Error(`${app} quit as it started:\n${printed}`);
      if (Date.now() > deadline) throw new Error(`${app} didn't show Add Site within ${START_TIME / 1000} seconds:\n${printed}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    console.log(`${app} starts and shows Add Site.`);
  } finally {
    started.kill();
    const killing = setTimeout(() => started.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(killing);
  }
}

/** Whether the app starting shows Add Site yet, by the pages it lists, or not while it doesn't answer. */
async function showsAddSite(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUGGING_PORT}/json/list`, { signal: AbortSignal.timeout(5_000) });
    const pages = (await response.json()) as { type: string; url: string; title: string }[];
    return pages.some((page) => page.type === "page" && page.url === ADD_SITE.url && page.title === ADD_SITE.title);
  } catch {
    return false;
  }
}

/** Runs `command`, returning what it printed, or failing with it. codesign and spctl print to stderr. */
function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const printed = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.error?.message ?? printed}`);
  return printed;
}

function expect(printed: string, pattern: RegExp, problem: string): void {
  if (!pattern.test(printed)) throw new Error(`${problem}:\n${printed}`);
}
