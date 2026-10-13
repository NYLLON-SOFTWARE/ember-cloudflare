import { feature } from "@ember/parity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_LINK, OFFLINE, UNAVAILABLE, openSetup } from "./setup-access";

const TOKEN = "0123456789abcdef".repeat(4);

let status: HTMLParagraphElement;
let replace: ReturnType<typeof vi.fn>;

/** This page, opened at `href`. */
function openAt(href: string) {
  replace = vi.fn();
  vi.stubGlobal("location", Object.assign(new URL(href), { replace }));
}

/** The server's answer to the token. */
const answer = (response: Partial<Response>) => vi.spyOn(globalThis, "fetch").mockResolvedValue(response as Response);

beforeEach(() => {
  status = document.createElement("p");
  status.textContent = "Opening your private setup link…";
  vi.spyOn(history, "replaceState").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe(feature("auth.protected-setup"), () => {
  it("takes the token out of the address, posts it as a form and opens setup", async () => {
    openAt(`https://ember.test/first_run/access#token=${TOKEN}`);
    const fetch = answer({ status: 204, type: "basic" });
    await openSetup(status);

    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/first_run/access");
    expect(vi.mocked(history.replaceState).mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]!);
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/first_run/access");
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
    });
    expect(String(init!.body)).toBe(`token=${TOKEN}`);
    expect(replace).toHaveBeenCalledWith("/first_run");
  });

  it("goes home when Ember is already set up", async () => {
    openAt(`https://ember.test/first_run/access#token=${TOKEN}`);
    answer({ status: 0, type: "opaqueredirect" });
    await openSetup(status);
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("says the link is unavailable when the server refuses it", async () => {
    openAt(`https://ember.test/first_run/access#token=${TOKEN}`);
    answer({ status: 403, type: "basic" });
    await openSetup(status);
    expect(status.textContent).toBe(UNAVAILABLE);
    expect(replace).not.toHaveBeenCalled();
  });

  it("says to reopen the link when the server can't be reached", async () => {
    openAt(`https://ember.test/first_run/access#token=${TOKEN}`);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await openSetup(status);
    expect(status.textContent).toBe(OFFLINE);
  });

  it.each([
    ["over plain HTTP", `http://ember.test/first_run/access#token=${TOKEN}`],
    ["without a token", "https://ember.test/first_run/access"],
    ["with part of the token", `https://ember.test/first_run/access#token=${TOKEN.slice(1)}`],
    ["with the token in uppercase", `https://ember.test/first_run/access#token=${TOKEN.toUpperCase()}`],
    ["with the token in the query", `https://ember.test/first_run/access?token=${TOKEN}`],
  ])("asks for the whole private HTTPS link when it's opened %s, and sends nothing", async (_, href) => {
    openAt(href);
    const fetch = vi.spyOn(globalThis, "fetch");
    await openSetup(status);
    expect(status.textContent).toBe(NO_LINK);
    expect(fetch).not.toHaveBeenCalled();
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/first_run/access");
  });
});
