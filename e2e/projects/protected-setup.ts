import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions, type Project } from "@playwright/test";

// A second test server, over HTTPS with EMBER_SETUP_TOKEN set, so its setup takes the private link.

export const PROTECTED_SETUP_PORT = Number(process.env.E2E_PROTECTED_PORT ?? 8789);
/** The test server's made-up setup token, which, like its session secret, guards nothing real. */
export const PROTECTED_SETUP_TOKEN = "0e2e".repeat(16);
/** The project that sets this server up, as the first-run project sets up the other. */
export const PROTECTED_SETUP = "protected-setup";

/** A desktop Chromium on this server. */
export const ON_PROTECTED_SERVER: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>["use"] = {
  ...devices["Desktop Chrome"],
  browserName: "chromium",
  baseURL: `https://127.0.0.1:${PROTECTED_SETUP_PORT}`,
  // `wrangler dev` serves HTTPS with a certificate of its own making. Chromium's own flag accepts
  // it during the handshake, rather than refusing it first, which the server would log as an error.
  ignoreHTTPSErrors: true,
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--ignore-certificate-errors"] },
};

export const protectedSetupProjects: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>[] = [
  { name: PROTECTED_SETUP, testDir: "./tests/protected-setup", use: ON_PROTECTED_SERVER },
];
