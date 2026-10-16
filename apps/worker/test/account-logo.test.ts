import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { apiWith } from "./support";

// ember-rust's logo controller with no logo uploaded (crates/ember/src/controllers/accounts/logos.rs,
// reference/test/controllers/accounts/logos_controller_test.rb).

/** The stock icons, as the built app's files have them. */
const icons: Record<string, Uint8Array> = {
  "/logos/app-icon.png": Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1),
  "/logos/app-icon-192.png": Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2),
};

/** Stands in for the built app's files, which the worker tests run without. */
const builtFiles = {
  fetch: async (input: Request | string | URL) => {
    const icon = icons[new URL(input instanceof Request ? input.url : input).pathname];
    return icon ? new Response(icon, { headers: { "Content-Type": "image/png" } }) : new Response("Not found", { status: 404 });
  },
} as unknown as Fetcher;

const logo = (path: string, init?: RequestInit<IncomingRequestCfProperties>) => apiWith({ ASSETS: builtFiles }, path, init);

const bytesOf = async (response: Response) => new Uint8Array(await response.arrayBuffer());

describe(feature("accounts.logo"), () => {
  it("serves Ember's stock app icon to anyone, and its 192-pixel one for size=small, kept five minutes and then a week while it's checked", async () => {
    const large = await logo("/account/logo");
    expect(large.status).toBe(200);
    expect(await bytesOf(large)).toEqual(icons["/logos/app-icon.png"]);
    expect(large.headers.get("Content-Type")).toBe("image/png");
    expect(large.headers.get("Content-Disposition")).toBe(`inline; filename="app-icon.png"; filename*=UTF-8''app-icon.png`);
    expect(large.headers.get("Cache-Control")).toBe("max-age=300, public, stale-while-revalidate=604800");

    const small = await logo("/account/logo?size=small");
    expect(await bytesOf(small)).toEqual(icons["/logos/app-icon-192.png"]);
    expect(small.headers.get("Content-Disposition")).toBe(`inline; filename="app-icon-192.png"; filename*=UTF-8''app-icon-192.png`);
    expect(small.headers.get("ETag")).not.toBe(large.headers.get("ETag"));

    // ember-rust's route takes a format.
    expect(await bytesOf(await logo("/account/logo.png"))).toEqual(icons["/logos/app-icon.png"]);
  });

  it("tells a browser whose copy is current that it is, and how long to keep it, and answers HEAD without the image", async () => {
    const etag = (await logo("/account/logo")).headers.get("ETag")!;
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/);

    const unchanged = await logo("/account/logo", { headers: { "If-None-Match": etag } });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("Cache-Control")).toBe("max-age=300, public, stale-while-revalidate=604800");

    const head = await logo("/account/logo", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("Content-Type")).toBe("image/png");
    expect(await head.text()).toBe("");
  });

  it("answers 404 to anything but GET and HEAD, as ember-rust has no other route there but removing a logo", async () => {
    expect((await logo("/account/logo", { method: "POST" })).status).toBe(404);
    expect((await logo("/account/logo/large")).status).toBe(404);
  });
});
