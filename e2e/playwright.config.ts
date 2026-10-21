import path from "node:path";
import { defineConfig } from "@playwright/test";
import { featureProjects, RECOVERY_TOKEN } from "./projects/features";
import { FIRST_RUN, firstRunProjects } from "./projects/first-run";
import { mobileProjects } from "./projects/mobile";
import { screenshotProjects } from "./projects/screenshots";
import { SETTINGS_SERVER_PORT, workspaceSettingsProjects } from "./projects/workspace-settings";
import type { MobileOptions } from "./tests/mobile/fixtures";

/**
 * The one Playwright config for every browser suite. Each suite adds its projects from ./projects/
 * and its specs under ./tests/<suite>/, and all of them share the server below.
 */

// Not 8787, so a running `pnpm dev` is never mistaken for the test server.
const port = Number(process.env.E2E_PORT ?? 8788);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig<MobileOptions>({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // CI installs the browser that matches @playwright/test. Sandboxes with a preinstalled
    // Chromium point at it instead: PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
  },
  // Every suite finds the server set up: the first-run project sets it up before the others start.
  projects: [
    ...firstRunProjects,
    ...workspaceSettingsProjects,
    ...[...featureProjects, ...mobileProjects, ...screenshotProjects].map((project) => ({ ...project, dependencies: [FIRST_RUN] })),
  ],
  // The production build and the API on one origin, served by `wrangler dev` the way the deployed
  // Worker serves them. State lives in e2e/.wrangler so tests never touch your local dev data, and
  // starts empty, since every open room a test makes takes in everyone who signs in after it.
  webServer: [
    {
      command: [
        `node -e "require('node:fs').rmSync('e2e/.wrangler/state', { recursive: true, force: true })"`,
        "pnpm --filter @ember/web build",
        `pnpm --filter @ember/worker exec wrangler dev -c ../../wrangler.jsonc --ip 127.0.0.1 --port ${port} --var SESSION_SECRET:e2e-only-not-a-secret --var EMBER_GUEST_SIGN_IN:true --var EMBER_RECOVERY_TOKEN:${RECOVERY_TOKEN} --persist-to ../../e2e/.wrangler/state`,
      ].join(" && "),
      cwd: path.resolve(import.meta.dirname, ".."),
      url: `${baseURL}/api/health`,
      env: { WRANGLER_SEND_METRICS: "false" },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    // The same build again, over HTTPS, for the workspace-settings projects. Servers start in turn,
    // so the app is built by then.
    {
      command: [
        `node -e "require('node:fs').rmSync('e2e/.wrangler/settings-state', { recursive: true, force: true })"`,
        `pnpm --filter @ember/worker exec wrangler dev -c ../../wrangler.jsonc --ip 127.0.0.1 --port ${SETTINGS_SERVER_PORT} --local-protocol https --var SESSION_SECRET:e2e-only-not-a-secret --persist-to ../../e2e/.wrangler/settings-state`,
      ].join(" && "),
      cwd: path.resolve(import.meta.dirname, ".."),
      url: `https://127.0.0.1:${SETTINGS_SERVER_PORT}/api/health`,
      ignoreHTTPSErrors: true,
      env: { WRANGLER_SEND_METRICS: "false" },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
