import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { isAppPage, workspacePageOf } from "./index";

describe(feature("platform.error-pages"), () => {
  it("names the pages the app shows, for the Worker to serve the app at", () => {
    const pages = ["/", "/rooms", "/rooms/general", "/rooms/caf%C3%A9", "/rooms/opens/general", "/rooms/directs/ada-grace", "/rooms/opens/new", "/rooms/closeds/new"];
    for (const path of [...pages, "/rooms/opens/general/edit", "/account/edit", "/account/custom_styles/edit", "/session/new"]) expect(isAppPage(path), path).toBe(true);
    expect(workspacePageOf("/rooms/caf%C3%A9")).toEqual({ page: "room", roomId: "café" });
  });

  it("names nothing at any other path, which answers 404", () => {
    const paths = ["/nope", "/index.html", "/account", "/account/custom_styles", "/users/1/extra", "/rooms/general/extra", "/rooms/opens/general/extra", "/messages/1"];
    for (const path of paths) expect(isAppPage(path), path).toBe(false);
  });

  it("names nothing at Rails' unused actions, which ember-rust answers 404 for", () => {
    for (const path of ["/rooms/new", "/rooms/general/edit"]) expect(isAppPage(path), path).toBe(false);
  });

  it("names nothing at a malformed escape, which can't be read", () => {
    for (const path of ["/rooms/%FF", "/rooms/%E0%A4", "/rooms/opens/%FF", "/rooms/closeds/%FF/edit"]) expect(workspacePageOf(path), path).toBeNull();
  });

  it("leaves extra slashes, setup's pages and the join link's to the Worker", () => {
    for (const path of ["/rooms/general/", "//rooms/general", "/session/new/", "/first_run", "/join/aB3d-Ef5h-iJ7k"]) expect(isAppPage(path), path).toBe(false);
  });
});

describe(feature("dms.picker"), () => {
  it("shows New direct message at its address", () => {
    expect(workspacePageOf("/rooms/directs/new")).toEqual({ page: "new-direct" });
    for (const path of ["/rooms/directs/new/", "/rooms/directs/new/edit"]) expect(workspacePageOf(path), path).not.toEqual({ page: "new-direct" });
  });
});

describe(feature("dms.naming"), () => {
  it("shows a DM's settings at its address", () => {
    expect(workspacePageOf("/rooms/directs/ada-grace/edit")).toEqual({ page: "direct-settings", roomId: "ada-grace" });
    expect(workspacePageOf("/rooms/directs/caf%C3%A9/edit")).toEqual({ page: "direct-settings", roomId: "café" });
    for (const path of ["/rooms/directs/%FF/edit", "/rooms/directs/ada-grace/edit/extra"]) expect(workspacePageOf(path), path).toBeNull();
  });
});

describe(feature("messages.permalink"), () => {
  it("opens a message's room at its permalink", () => {
    expect(workspacePageOf("/rooms/caf%C3%A9/@m-1")).toEqual({ page: "room", roomId: "café" });
    for (const path of ["/rooms/general/@", "/rooms/general/@m-1/extra", "/rooms/new/@m-1"]) expect(isAppPage(path), path).toBe(false);
  });
});

describe(feature("users.profile"), () => {
  it("shows your profile at anyone's profile address, as ember-rust ignores whose it names", () => {
    for (const path of ["/users/me/profile", "/users/01J9Z3/profile"]) expect(workspacePageOf(path), path).toEqual({ page: "profile" });
    for (const path of ["/users/me/profile/", "/users/me/profile/edit"]) expect(workspacePageOf(path), path).toBeNull();
  });
});

describe(feature("users.show"), () => {
  it("shows someone's page at /users/<id>, whatever the id, as ember-rust's router reads one", () => {
    expect(workspacePageOf("/users/0mgk3x2a9b4c5d")).toEqual({ page: "person", userId: "0mgk3x2a9b4c5d" });
    expect(workspacePageOf("/users/caf%C3%A9")).toEqual({ page: "person", userId: "café" });
    // An id nobody has is the page's to answer 404 for.
    expect(workspacePageOf("/users/profile")).toEqual({ page: "person", userId: "profile" });
    for (const path of ["/users", "/users/", "/users/%FF", "/users/ada/edit"]) expect(workspacePageOf(path), path).toBeNull();
  });
});
