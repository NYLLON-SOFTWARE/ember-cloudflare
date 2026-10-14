import type { PlaywrightTestOptions, PlaywrightWorkerOptions, Project } from "@playwright/test";
import { ON_PROTECTED_SERVER, PROTECTED_SETUP } from "./protected-setup";

// Tests that change the whole workspace, such as its name, which every other suite's pages show.
// They use the protected-setup server once it's set up, so the main test server's workspace stays as
// the other suites expect it, and take turns, since one regenerating the join link would stop
// another's new person joining through it.
export const workspaceSettingsProjects: Project<PlaywrightTestOptions, PlaywrightWorkerOptions>[] = [
  {
    name: "workspace-settings",
    testDir: "./tests/workspace-settings",
    fullyParallel: false,
    workers: 1,
    dependencies: [PROTECTED_SETUP],
    use: ON_PROTECTED_SERVER,
  },
];
