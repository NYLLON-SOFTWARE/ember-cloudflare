import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
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
    // `wrangler dev` serves the API, room sockets and QR codes on 8787.
    proxy: { "/api": { target: "http://localhost:8787", ws: true }, "/qr_code": "http://localhost:8787" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
