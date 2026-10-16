import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// The Worker's suite runs inside workerd once per storage backend; the deploy scripts' tests run in Node.
const migrations = await readD1Migrations("./migrations");
const searchMigrations = await readD1Migrations("./search-migrations");

const backend = (name: "do-sqlite" | "d1") => ({
  extends: true as const,
  test: { name, include: ["test/**/*.test.ts"], setupFiles: name === "d1" ? ["./test/apply-migrations.ts"] : [] },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-secret",
          STORAGE_BACKEND: name,
          EMBER_GUEST_SIGN_IN: "true",
          TEST_MIGRATIONS: migrations,
          TEST_SEARCH_MIGRATIONS: searchMigrations,
        },
        d1Databases: name === "d1" ? ["DB"] : [],
      },
    }),
  ],
});

export default defineConfig({
  test: {
    projects: [backend("do-sqlite"), backend("d1"), { test: { name: "scripts", include: ["scripts/**/*.test.ts"], environment: "node" } }],
  },
});
