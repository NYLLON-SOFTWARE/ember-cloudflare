import path from "node:path";
import { defineConfig } from "@playwright/test";
import { featureProjects } from "./projects/features";
import { mobileProjects } from "./projects/mobile";
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
  projects: [...featureProjects, ...mobileProjects],
  // The production build and the API on one origin, served by `wrangler dev` the way the deployed
  // Worker serves them. State lives in e2e/.wrangler so tests never touch your local dev data.
  webServer: {
    command: [
      "pnpm --filter @ember/web build",
      `pnpm --filter @ember/worker exec wrangler dev --ip 127.0.0.1 --port ${port} --var SESSION_SECRET:e2e-only-not-a-secret --persist-to ../../e2e/.wrangler/state`,
    ].join(" && "),
    cwd: path.resolve(import.meta.dirname, ".."),
    url: `${baseURL}/api/health`,
    env: { WRANGLER_SEND_METRICS: "false" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
