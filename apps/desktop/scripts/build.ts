// Builds the app into dist/, afresh: its TypeScript, then what its pages need beside their scripts (their
// HTML and CSS, and Ember's flame from the web app), and the icons its windows show in each appearance.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const desktop = path.join(import.meta.dirname, "..");
const dist = path.join(desktop, "dist");
const pages = path.join(desktop, "src", "pages");

fs.rmSync(dist, { recursive: true, force: true });
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
execFileSync(process.execPath, [tsc, "-p", path.join(desktop, "tsconfig.build.json")], { stdio: "inherit" });

for (const file of fs.readdirSync(pages).filter((name) => /\.(html|css)$/.test(name))) {
  fs.copyFileSync(path.join(pages, file), path.join(dist, "pages", file));
}
fs.copyFileSync(path.join(desktop, "..", "web", "public", "ember-icon.png"), path.join(dist, "pages", "ember-icon.png"));
fs.cpSync(path.join(desktop, "src", "icons"), path.join(dist, "icons"), { recursive: true });
