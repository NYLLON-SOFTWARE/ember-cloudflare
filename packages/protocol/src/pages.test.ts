import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { isAppPage, MAX_ID_LENGTH, transferIdFromPath, transferPath, workspacePageOf } from "./index";

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
  it("opens a message's room at its permalink, around the message", () => {
    expect(workspacePageOf("/rooms/caf%C3%A9/@m-1")).toEqual({ page: "room", roomId: "café", messageId: "m-1" });
    expect(workspacePageOf("/rooms/general/@m%2D1")).toEqual({ page: "room", roomId: "general", messageId: "m-1" });
    for (const path of ["/rooms/general/@", "/rooms/general/@m-1/extra", "/rooms/new/@m-1"]) expect(isAppPage(path), path).toBe(false);
  });

  it("opens the room at its newest messages for a permalink whose message id is malformed or too long for one", () => {
    expect(workspacePageOf("/rooms/general/@%FF")).toEqual({ page: "room", roomId: "general" });
    expect(workspacePageOf(`/rooms/general/@${"m".repeat(MAX_ID_LENGTH + 1)}`)).toEqual({ page: "room", roomId: "general" });
    const longest = "m".repeat(MAX_ID_LENGTH);
    expect(workspacePageOf(`/rooms/general/@${longest}`)).toEqual({ page: "room", roomId: "general", messageId: longest });
  });

  it("reads a message's own address, which goes on to its permalink", () => {
    expect(workspacePageOf("/rooms/caf%C3%A9/messages/m%2D1")).toEqual({ page: "message", roomId: "café", messageId: "m-1" });
    for (const path of ["/rooms/general/messages/%FF", `/rooms/general/messages/${"m".repeat(MAX_ID_LENGTH + 1)}`]) {
      expect(workspacePageOf(path), path).toEqual({ page: "message", roomId: "general" });
    }
    for (const path of ["/rooms/general/messages", "/rooms/general/messages/", "/rooms/general/messages/m-1/extra", "/rooms/new/messages/m-1"]) {
      expect(isAppPage(path), path).toBe(false);
    }
  });
});

describe(feature("users.profile"), () => {
  it("shows your profile at anyone's profile address, as ember-rust ignores whose it names", () => {
    for (const path of ["/users/me/profile", "/users/01J9Z3/profile"]) expect(workspacePageOf(path), path).toEqual({ page: "profile" });
    for (const path of ["/users/me/profile/", "/users/me/profile/edit"]) expect(workspacePageOf(path), path).toBeNull();
  });
});

describe(feature("notifications.test-page"), () => {
  it("shows your push subscriptions at anyone's address for them, as ember-rust ignores whose it names", () => {
    for (const path of ["/users/me/push_subscriptions", "/users/01J9Z3/push_subscriptions"]) {
      expect(workspacePageOf(path), path).toEqual({ page: "push-subscriptions" });
    }
    for (const path of ["/users/me/push_subscriptions/", "/users/me/push_subscriptions/new", "/users/me/push_subscriptions/1"]) {
      expect(workspacePageOf(path), path).toBeNull();
    }
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

describe(feature("bots.list"), () => {
  it("shows the Chat bots page at `/account/bots`, where a bot's own address names nothing, as in ember-rust", () => {
    expect(workspacePageOf("/account/bots")).toEqual({ page: "bots" });
    for (const path of ["/account/bots/", "/account/bots/0mgk3x2a9b4c5e", "/account/bot"]) expect(workspacePageOf(path), path).toBeNull();
  });
});

describe(feature("bots.create-edit"), () => {
  it("shows Add a chat bot at `/account/bots/new`, and a bot's settings at `/account/bots/<id>/edit`", () => {
    expect(workspacePageOf("/account/bots/new")).toEqual({ page: "new-bot" });
    expect(workspacePageOf("/account/bots/0mgk3x2a9b4c5e/edit")).toEqual({ page: "bot-settings", userId: "0mgk3x2a9b4c5e" });
    expect(workspacePageOf("/account/bots/caf%C3%A9/edit")).toEqual({ page: "bot-settings", userId: "café" });
    for (const path of ["/account/bots/new/", "/account/bots/%FF/edit", "/account/bots/0mgk3x2a9b4c5e/edit/extra", "/account/bots/0mgk3x2a9b4c5e/key"]) {
      expect(workspacePageOf(path), path).toBeNull();
    }
  });
});

describe(feature("auth.sign-in-link"), () => {
  it("puts a sign-in link at /session/transfers/<id>, and reads the id back", () => {
    const transferId = "0mgk3x2a9b4c5d.mgk3x2a9.Ab-_9z";
    expect(transferPath(transferId)).toBe(`/session/transfers/${transferId}`);
    expect(transferIdFromPath(transferPath(transferId))).toBe(transferId);
    for (const path of ["/session/transfers", "/session/transfers/", "/session/transfers/a/b", "/session/transfer/a"]) expect(transferIdFromPath(path), path).toBeNull();
  });

  it("leaves a sign-in link's page to the Worker, as it's no workspace page", () => {
    expect(workspacePageOf(transferPath("a.b.c"))).toBeNull();
    expect(isAppPage(transferPath("a.b.c"))).toBe(false);
  });
});

describe(feature("search.page"), () => {
  it("shows search at `/searches`, whatever its query string, which the path leaves out", () => {
    expect(workspacePageOf("/searches")).toEqual({ page: "search" });
    expect(isAppPage("/searches")).toBe(true);
    for (const path of ["/searches/", "/searches/clear", "/search"]) expect(workspacePageOf(path), path).toBeNull();
  });
});
