import { describe, expect, it } from "vitest";
import { destinationOf, mayBeMoving, mayBeSigningIn, passageOf } from "./navigation.ts";

const SITE = "https://chat.example.com";
const MEMBERFUL = "https://fernwood.memberful.com";

describe("destinationOf", () => {
  it("keeps the site's own pages, and what they make, in its window", () => {
    for (const url of [`${SITE}/`, `${SITE}/rooms/1?tab=pins#top`, `blob:${SITE}/0d6f`]) {
      expect(destinationOf(url, SITE)).toBe("window");
    }
  });

  it("opens web pages elsewhere, and email addresses, outside the app", () => {
    for (const url of ["https://example.com/", "http://chat.example.com/", "https://chat.example.com:8443/", "mailto:ada@example.com"]) {
      expect(destinationOf(url, SITE)).toBe("outside");
    }
  });

  it("goes nowhere for anything else", () => {
    for (const url of ["file:///etc/hosts", "javascript:alert(1)", "data:text/html,<p>Hi", "about:blank", "slack://open", "not a url"]) {
      expect(destinationOf(url, SITE)).toBe("nowhere");
    }
  });

  it("keeps the site it's passing through as someone signs in there in the window, but no other", () => {
    expect(destinationOf(`${MEMBERFUL}/oauth?state=1`, SITE, MEMBERFUL)).toBe("window");
    expect(destinationOf("https://example.com/", SITE, MEMBERFUL)).toBe("outside");
  });
});

describe("passageOf", () => {
  it("passes through the Memberful site the site's Sign in with Memberful redirects to", () => {
    expect(passageOf(`${SITE}/auth/memberful?return_to=%2Frooms%2F1`, `${MEMBERFUL}/oauth?client_id=1&state=2`, SITE)).toBe(MEMBERFUL);
    expect(passageOf(`${SITE}/auth/memberful`, "https://members.example.org/oauth", SITE)).toBe("https://members.example.org");
  });

  it("passes through nothing on any other redirect, or to an insecure site", () => {
    expect(passageOf(`${SITE}/rooms/1`, `${MEMBERFUL}/oauth`, SITE)).toBeNull();
    expect(passageOf(`https://example.com/auth/memberful`, `${MEMBERFUL}/oauth`, SITE)).toBeNull();
    expect(passageOf(`${SITE}/auth/memberful`, "http://fernwood.memberful.com/oauth", SITE)).toBeNull();
    expect(passageOf(`${SITE}/auth/memberful`, `${SITE}/session/new`, SITE)).toBeNull();
  });
});

describe("mayBeMoving", () => {
  it("takes the same page at another secure address for a move to a custom domain", () => {
    expect(mayBeMoving("https://ember.example.workers.dev/rooms/1", "https://chat.example.com/rooms/1?replacing_push=abc")).toBe(true);
  });

  it("takes another page, the same address or an insecure one for no move", () => {
    expect(mayBeMoving(`${SITE}/rooms/1`, "https://example.com/blog")).toBe(false);
    expect(mayBeMoving(`${SITE}/rooms/1`, `${SITE}/rooms/1`)).toBe(false);
    expect(mayBeMoving(`${SITE}/rooms/1`, "http://example.com/rooms/1")).toBe(false);
  });
});

describe("mayBeSigningIn", () => {
  it("takes Memberful's sign-in for Ember, with its state, at a secure address", () => {
    expect(mayBeSigningIn(`${MEMBERFUL}/oauth?response_type=code&client_id=1&state=2`)).toBe(true);
    expect(mayBeSigningIn("http://127.0.0.1:8790/oauth?state=2")).toBe(true);
  });

  it("takes another page, one without a state or an insecure one for something else", () => {
    expect(mayBeSigningIn(`${MEMBERFUL}/account`)).toBe(false);
    expect(mayBeSigningIn(`${MEMBERFUL}/oauth`)).toBe(false);
    expect(mayBeSigningIn("http://fernwood.memberful.com/oauth?state=2")).toBe(false);
    expect(mayBeSigningIn("mailto:ada@example.com")).toBe(false);
  });
});
