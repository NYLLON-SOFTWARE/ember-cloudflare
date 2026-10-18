import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Serves each icon a room can have as an SVG of its own at /lucide/icons/<name>.svg, which `RoomIcon`
 * draws, writing them from ember-rust's catalog in src/components/icons/lucide/ (its README says more).
 */
function roomIcons(): Plugin {
  type Catalog = Array<{ name: string; svg: string }>;
  let catalog: Catalog | undefined;
  const icons = () => (catalog ??= JSON.parse(readFileSync(path.resolve(import.meta.dirname, "src/components/icons/lucide/catalog.json"), "utf8")) as Catalog);
  return {
    name: "ember-room-icons",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = /^\/lucide\/icons\/([a-z0-9-]+)\.svg$/.exec(request.url ?? "")?.[1];
        const icon = name && icons().find((icon) => icon.name === name);
        if (!icon) return next();
        response.setHeader("Content-Type", "image/svg+xml");
        response.end(icon.svg);
      });
    },
    // Written beside the bundle rather than emitted with it, which would list all 1,869 in the build's output.
    writeBundle({ dir }) {
      const folder = path.join(dir!, "lucide/icons");
      mkdirSync(folder, { recursive: true });
      for (const { name, svg } of icons()) writeFileSync(path.join(folder, `${name}.svg`), svg);
    },
  };
}

/**
 * Fails the build when the app's script imports another besides Rolldown's runtime: one more for the page to
 * load before the app can run. Rolldown leaves what the main chunk shares with the pages few visits need and
 * the editor in a chunk of its own when the main chunk imports a module it doesn't use that those pages do, as
 * @ember/protocol's index did bots.ts until the bot pages imported it from @ember/protocol/bots.
 */
function oneAppScript(): Plugin {
  const app = path.resolve(import.meta.dirname, "index.html");
  return {
    name: "ember-one-app-script",
    apply: "build",
    generateBundle(_, bundle) {
      const script = Object.values(bundle).find((chunk) => chunk.type === "chunk" && chunk.facadeModuleId === app);
      const more = script?.type === "chunk" ? script.imports.filter((name) => bundle[name]?.name !== "rolldown-runtime") : [];
      if (more.length > 0) this.error(`The app's script imports ${more.join(", ")} besides Rolldown's runtime, so the page loads one more before the app can run (see oneAppScript).`);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), roomIcons(), oneAppScript()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Lexxy's package exports only its scripts, so its stylesheets are reached by their path.
      "@37signals/lexxy/stylesheets": path.resolve(import.meta.dirname, "node_modules/@37signals/lexxy/dist/stylesheets"),
    },
  },
  build: {
    // The polyfill would be a chunk of its own once there are two pages, and one more request for the
    // app's. Browsers without modulepreload still load everything; they just don't fetch it early.
    modulePreload: { polyfill: false },
    rolldownOptions: {
      // The app, and the page that opens the private setup link, which only the Worker serves.
      input: [path.resolve(import.meta.dirname, "index.html"), path.resolve(import.meta.dirname, "first_run/access.html")],
    },
  },
  server: {
    // `wrangler dev` serves the API, room sockets, web app manifest, QR codes and avatars on 8787.
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
      "/webmanifest": "http://localhost:8787",
      "/qr_code": "http://localhost:8787",
      // Only avatars, so people's pages under /users, once they're built, stay the app's.
      "^/users/[^/]+/avatar": "http://localhost:8787",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
