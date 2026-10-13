import { devices, type PlaywrightTestOptions, type PlaywrightWorkerOptions, type Project } from "@playwright/test";

// The feature-by-feature suite: one test file per area of PARITY.md, on a desktop Chromium. Tests
// that need a phone or a second person open their own browser contexts with `members.signIn`.
export const featureProjects: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>[] = [
  {
    name: "features",
    testDir: "./tests/features",
    use: { ...devices["Desktop Chrome"], browserName: "chromium" },
  },
];
