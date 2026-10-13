import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions, type Project } from "@playwright/test";

// A second test server, over HTTPS with EMBER_SETUP_TOKEN set, so its setup takes the private link.

export const PROTECTED_SETUP_PORT = Number(process.env.E2E_PROTECTED_PORT ?? 8789);
/** The test server's made-up setup token, which, like its session secret, guards nothing real. */
export const PROTECTED_SETUP_TOKEN = "0e2e".repeat(16);

export const protectedSetupProjects: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>[] = [
  {
    name: "protected-setup",
    testDir: "./tests/protected-setup",
    use: {
      ...devices["Desktop Chrome"],
      browserName: "chromium",
      baseURL: `https://127.0.0.1:${PROTECTED_SETUP_PORT}`,
      // `wrangler dev` serves HTTPS with a certificate of its own making. Chromium's own flag accepts
      // it during the handshake, rather than refusing it first, which the server would log as an error.
      ignoreHTTPSErrors: true,
      launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--ignore-certificate-errors"] },
    },
  },
];
