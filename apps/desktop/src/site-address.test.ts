import { describe, expect, it } from "vitest";
import { siteAddressOf } from "./site-address.ts";

describe("siteAddressOf", () => {
  it("takes the origin of an address typed with or without its scheme, a page's or a port's", () => {
    for (const typed of ["chat.example.com", " chat.example.com ", "https://chat.example.com", "chat.example.com/rooms/1?x=1#top", "HTTPS://Chat.Example.com/"]) {
      expect(siteAddressOf(typed)).toBe("https://chat.example.com");
    }
    expect(siteAddressOf("chat.example.com:8443")).toBe("https://chat.example.com:8443");
    expect(siteAddressOf("https://chat.example.com:443")).toBe("https://chat.example.com");
  });

  it("opens a site elsewhere over https, though it's typed with http", () => {
    expect(siteAddressOf("http://chat.example.com")).toBe("https://chat.example.com");
  });

  it("opens this computer's own Ember over http unless it's typed with https", () => {
    expect(siteAddressOf("localhost:8787")).toBe("http://localhost:8787");
    expect(siteAddressOf("127.0.0.1:8787/rooms/1")).toBe("http://127.0.0.1:8787");
    expect(siteAddressOf("http://[::1]:8787")).toBe("http://[::1]:8787");
    expect(siteAddressOf("https://localhost:8443")).toBe("https://localhost:8443");
  });

  it("refuses what isn't a web address", () => {
    for (const typed of ["", "   ", "chat example.com", "ftp://chat.example.com", "file:///etc/hosts", "mailto:ada@example.com", "https://ada:secret@chat.example.com", "https://"]) {
      expect(siteAddressOf(typed)).toBeNull();
    }
  });
});
