import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The same suite runs once per storage backend.
const migrations = await readD1Migrations("./migrations");

const backend = (name: "do-sqlite" | "d1") => ({
  extends: true as const,
  test: { name, setupFiles: name === "d1" ? ["./test/apply-migrations.ts"] : [] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { SESSION_SECRET: "test-secret", STORAGE_BACKEND: name, EMBER_GUEST_SIGN_IN: "true", TEST_MIGRATIONS: migrations },
        d1Databases: name === "d1" ? ["DB"] : [],
      },
    }),
  ],
});

export default defineConfig({
  test: { projects: [backend("do-sqlite"), backend("d1")] },
});
