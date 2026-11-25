import { defineConfig } from "vitest/config";

// The unit tests beside the code. The app's own tests, which drive it, are Playwright's, in test/.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
