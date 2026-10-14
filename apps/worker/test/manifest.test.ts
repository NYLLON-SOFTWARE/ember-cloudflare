import { feature } from "@ember/parity";
import { evictDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, apiWith, builtPages, freshDeploy, workspaceSql, workspaceStub } from "./support";

const manifest = async (path = "/webmanifest.json") => (await (await api(path)).json()) as Record<string, unknown>;

beforeEach(freshDeploy);

describe(feature("platform.manifest"), () => {
  it("answers JSON without sign-in, naming the app Ember until the workspace is set up", async () => {
    const response = await api("/webmanifest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response.json()).toMatchObject({ name: "Ember" });
  });

  it("names the app after the workspace", async () => {
    const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "12345678" }) });
    expect(setUp.status).toBe(201);
    expect(await manifest()).toMatchObject({ name: "Ember" });

    // Nothing renames a workspace yet, so rename it in its table, and start the Workspace afresh.
    await workspaceSql("UPDATE accounts SET name = ?", "Analytical Engines");
    await evictDurableObject(workspaceStub());
    expect(await manifest()).toMatchObject({ name: "Analytical Engines" });
  });

  it("lists Ember's icons and ember-rust's shortcuts, colors and categories, with this project's description", async () => {
    expect(await manifest()).toEqual({
      name: "Ember",
      icons: [
        { src: "/logos/app-icon-192.png", type: "image/png", sizes: "192x192" },
        { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512" },
        { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
      ],
      start_url: "/",
      display: "standalone",
      scope: "/",
      description: "A real-time chat app that runs entirely on Cloudflare.",
      categories: ["social", "business", "productivity"],
      theme_color: "#ffffff",
      background_color: "#ffffff",
      shortcuts: [
        { name: "New chat room", description: "Open Ember and start a new chat room", url: "rooms/opens/new", icons: [{ src: "/shortcuts/add.svg", sizes: "any" }] },
        { name: "My profile", description: "Open Ember and view your profile", url: "/users/me/profile", icons: [{ src: "/shortcuts/person.svg", sizes: "any" }] },
      ],
    });
  });

  it("answers at /webmanifest too, and refuses any format but JSON", async () => {
    expect(await manifest("/webmanifest")).toEqual(await manifest());
    for (const path of ["/webmanifest.html", "/webmanifest.xml", "/webmanifest.js"]) {
      const response = await api(path);
      expect(response.status, path).toBe(406);
      expect(await response.text(), path).toBe("");
    }
  });

  it("leaves addresses that only start like it to the app", async () => {
    for (const path of ["/webmanifests", "/webmanifest/"]) {
      const response = await apiWith({ ASSETS: builtPages }, path);
      expect(await response.text(), path).toBe(`page ${path}`);
    }
  });
});
