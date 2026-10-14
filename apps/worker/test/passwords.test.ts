import { feature } from "@ember/parity";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { toBase64 } from "../src/encoding";
import type { Env } from "../src/env";
import { DUMMY_DIGEST, hashPassword, passwordHasher, verifyPassword } from "../src/passwords";

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));

describe(feature("auth.first-run"), () => {
  it("keeps a password as a salted PBKDF2-SHA256 digest that names its scheme and cost", async () => {
    const digest = await hashPassword("correct horse");
    // 16 bytes of salt and 32 of hash, in unpadded base64.
    expect(digest).toMatch(/^\$pbkdf2-sha256\$i=100000\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(digest).not.toContain("correct horse");
  });

  it("verifies the password a digest was made from, and no other", async () => {
    const digest = await hashPassword("correct horse");
    expect(await verifyPassword("correct horse", digest)).toBe(true);
    for (const other of ["Correct horse", "correct horse ", "correct", ""]) expect(await verifyPassword(other, digest), other).toBe(false);
  });

  it("salts every digest, so the same password never makes the same one twice", async () => {
    const [first, second] = await Promise.all([hashPassword("12345678"), hashPassword("12345678")]);
    expect(first).not.toBe(second);
    expect(await verifyPassword("12345678", second!)).toBe(true);
  });

  it("verifies with the iterations and length a digest names", async () => {
    // RFC 7914's PBKDF2-HMAC-SHA256 test vector: P = "passwd", S = "salt", c = 1, dkLen = 64.
    const hash = fromHex("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783");
    const digest = `$pbkdf2-sha256$i=1$${toBase64(new TextEncoder().encode("salt"))}$${toBase64(hash)}`;
    expect(await verifyPassword("passwd", digest)).toBe(true);
    expect(await verifyPassword("Passwd", digest)).toBe(false);
  });

  it.each([
    ["nothing", ""],
    ["bcrypt's", "$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"],
    ["another scheme's", "$pbkdf2-sha1$i=100000$c2FsdA$c2FsdA"],
    ["no iterations", "$pbkdf2-sha256$i=0$c2FsdA$c2FsdA"],
    ["no salt", "$pbkdf2-sha256$i=1$$c2FsdA"],
    ["padded base64", "$pbkdf2-sha256$i=1$c2FsdA==$c2FsdA=="],
    ["base64 that decodes to nothing", "$pbkdf2-sha256$i=1$c2FsdA$A"],
  ])("refuses every password for %s digest", async (_, digest) => {
    expect(await verifyPassword("passwd", digest)).toBe(false);
  });

  it("hashes in a Durable Object, where there's CPU time for it", async () => {
    const digest = await passwordHasher(env as unknown as Env).hash("12345678");
    expect(await verifyPassword("12345678", digest)).toBe(true);
    expect(await passwordHasher(env as unknown as Env).verify("12345678", digest)).toBe(true);
  });
});

describe(feature("auth.sign-in"), () => {
  it("checks an unknown address's password against a digest that costs as much as a real one and matches nothing", async () => {
    const real = await hashPassword("12345678");
    // The same scheme and iterations, so the check takes as long.
    expect(DUMMY_DIGEST.split("$").slice(0, 3)).toEqual(real.split("$").slice(0, 3));
    for (const password of ["12345678", "password", "analytical engine"]) expect(await verifyPassword(password, DUMMY_DIGEST), password).toBe(false);
  });
});
