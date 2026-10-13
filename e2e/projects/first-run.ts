import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions, type Project } from "@playwright/test";

/** Sets up the test server's workspace, as its first visitor would. Every other suite needs it. */
export const FIRST_RUN = "first-run";

export const firstRunProjects: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>[] = [
  {
    name: FIRST_RUN,
    testDir: "./tests/first-run",
    use: { ...devices["Desktop Chrome"], browserName: "chromium" },
  },
];
