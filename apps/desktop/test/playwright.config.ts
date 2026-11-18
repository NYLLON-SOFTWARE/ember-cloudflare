import { defineConfig } from "@playwright/test";

// The app's own tests, which start it with Playwright's Electron support and add made-up sites to it,
// each test with a folder of its own for the app's sites. They drive the built app: `pnpm test:app`
// builds it first.

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  // Starting the app takes a few seconds, and some tests start it twice.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
});
