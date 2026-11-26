import { beforeEach, describe, expect, it } from "vitest";
import { api, apiWith, builtPages, cookieOf, freshDeploy } from "./support";

const manifest = async (path = "/webmanifest.json") => (await (await api(path)).json()) as Record<string, unknown>;

beforeEach(freshDeploy);

describe("Web app manifest", () => {
  it("answers JSON without sign-in, naming the app Ember until the workspace is set up", async () => {
    const response = await api("/webmanifest.json");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response.json()).toMatchObject({ name: "Team Lopez", short_name: "Team Lopez" });
  });

  it("names the app after the workspace", async () => {
    const setUp = await api("/api/first_run", { method: "POST", body: JSON.stringify({ name: "Ada Lovelace", emailAddress: "ada@example.com", password: "12345678" }) });
    expect(setUp.status).toBe(201);
    expect(await manifest()).toMatchObject({ name: "Team Lopez" });

    const rename = await api("/api/account", { method: "PATCH", headers: { Cookie: cookieOf(setUp) }, body: JSON.stringify({ name: "Analytical Engines" }) });
    expect(rename.status).toBe(200);
    expect(await manifest()).toMatchObject({ name: "Analytical Engines" });
  });

  it("lists Ember's icons and screenshots and Campfire's shortcuts, colors and categories, with this project's description", async () => {
    expect(await manifest()).toEqual({
      name: "Team Lopez",
      short_name: "Team Lopez",
      icons: [
        { src: "/logos/app-icon-192.png", type: "image/png", sizes: "192x192" },
        { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512" },
        { src: "/logos/app-icon.png", type: "image/png", sizes: "512x512", purpose: "maskable" },
      ],
      start_url: "/",
      display: "standalone",
      scope: "/",
      description: "Team Lopez — internal chat for the Victor Lopez for Hammond City Council campaign.",
      categories: ["social", "business", "productivity"],
      theme_color: "#000000",
      background_color: "#f2eee2",
      shortcuts: [
        { name: "New chat room", description: "Open Team Lopez and start a new chat room", url: "rooms/opens/new", icons: [{ src: "/shortcuts/plus.svg", sizes: "any" }] },
        { name: "My profile", description: "Open Team Lopez and view your profile", url: "/users/me/profile", icons: [{ src: "/shortcuts/user.svg", sizes: "any" }] },
      ],
      screenshots: [
        { src: "/screenshots/chat.png", sizes: "1080x2400", form_factor: "narrow", label: "Team Lopez is the campaign's installable team chat." },
        { src: "/screenshots/sidebar.png", sizes: "1080x2400", form_factor: "narrow", label: "Invite people. Make rooms. @mentions, DMs, and mobile support." },
        { src: "/screenshots/dark-mode.png", sizes: "1080x2400", form_factor: "narrow", label: "Light and dark, in the campaign's black, white, and gold." },
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
