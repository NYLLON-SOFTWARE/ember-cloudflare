import { feature } from "@ember/parity";
import { describe, expect, it, vi } from "vitest";
import { SessionCache } from "../src/session-cache";

/** A lookup that finds `session`, counting its calls. */
const finding = (session: string | null) => vi.fn(async () => session);

describe(feature("auth.sessions"), () => {
  it("keeps the sessions it finds, so the Workspace looks each up once", async () => {
    const cache = new SessionCache<string>(10);
    const lookUp = finding("Ada's");
    expect(await cache.get("a", lookUp)).toBe("Ada's");
    expect(await cache.get("a", lookUp)).toBe("Ada's");
    expect(lookUp).toHaveBeenCalledTimes(1);
  });

  it("looks again for a session it didn't find", async () => {
    const cache = new SessionCache<string>(10);
    const lookUp = finding(null);
    expect(await cache.get("a", lookUp)).toBeNull();
    expect(await cache.get("a", lookUp)).toBeNull();
    expect(lookUp).toHaveBeenCalledTimes(2);
  });

  it("forgets the least recently used session past its limit", async () => {
    const cache = new SessionCache<string>(2);
    await cache.get("a", finding("Ada's"));
    cache.remember("b", "Grace's");
    await cache.get("a", finding(null));
    cache.remember("c", "Linus's");

    expect(await cache.get("a", finding(null))).toBe("Ada's");
    expect(await cache.get("c", finding(null))).toBe("Linus's");
    expect(await cache.get("b", finding(null))).toBeNull();
  });

  it("forgets a session once it ends, even if ending it failed", async () => {
    const cache = new SessionCache<string>(10);
    cache.remember("a", "Ada's");
    cache.remember("b", "Grace's");
    await cache.end("a", async () => {});
    await expect(cache.end("b", () => Promise.reject(new Error("Storage isn't answering")))).rejects.toThrow();

    expect(await cache.get("a", finding(null))).toBeNull();
    expect(await cache.get("b", finding(null))).toBeNull();
  });

  it("doesn't keep a session found while one was ending, since it may have been read before it went", async () => {
    const cache = new SessionCache<string>(10);
    let found!: (session: string) => void;
    const lookingUp = cache.get("a", () => new Promise<string | null>((resolve) => (found = resolve)));
    await cache.end("a", async () => {});
    found("Ada's");
    expect(await lookingUp).toBe("Ada's");

    const lookUp = finding(null);
    expect(await cache.get("a", lookUp)).toBeNull();
    expect(lookUp).toHaveBeenCalledOnce();
  });
});
