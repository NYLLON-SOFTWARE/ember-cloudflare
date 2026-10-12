import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "../src/session";

describe("session tokens", () => {
  const user = { id: "u1", name: "Ada" };

  it("round-trips a signed user", async () => {
    expect(await verifyToken(await issueToken(user, "secret"), "secret")).toEqual(user);
  });

  it("rejects other secrets, tampering and expired tokens", async () => {
    const token = await issueToken(user, "secret", Date.UTC(2026, 0, 1));
    expect(await verifyToken(token, "other")).toBeNull();
    expect(await verifyToken(token.replace(/^./, "x"), "secret")).toBeNull();
    expect(await verifyToken(token, "secret", Date.UTC(2026, 3, 1))).toBeNull();
  });
});
