import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "../src/session";

const DAY = 24 * 60 * 60 * 1000;

describe(feature("auth.sessions"), () => {
  const user = { id: "u1", name: "Ada" };

  it("keeps people signed in for 30 days", async () => {
    const issued = Date.UTC(2026, 0, 1);
    const token = await issueToken(user, "secret", issued);
    expect(await verifyToken(token, "secret", issued + 29 * DAY)).toEqual(user);
    expect(await verifyToken(token, "secret", issued + 31 * DAY)).toBeNull();
  });

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
