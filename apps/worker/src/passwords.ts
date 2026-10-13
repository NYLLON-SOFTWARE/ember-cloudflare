import { DurableObject } from "cloudflare:workers";
import { fromBase64, toBase64 } from "./encoding";
import type { Env } from "./env";

// Passwords are kept as PBKDF2-SHA256 digests that name their scheme and cost, in the PHC string
// format: `$pbkdf2-sha256$i=<iterations>$<salt>$<hash>`. ember-rust uses bcrypt, which Workers could
// only run compiled to WebAssembly, far slower than Web Crypto's PBKDF2. Because each digest says how
// it was made, moving to a stronger hash later is a matter of rehashing at sign-in.

/** The most iterations Web Crypto allows on Workers. */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const DIGEST = /^\$pbkdf2-sha256\$i=([1-9]\d*)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const encoder = new TextEncoder();

async function pbkdf2(password: string, salt: Uint8Array, iterations: number, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, bytes * 8));
}

/** A new digest of `password`, with a salt of its own. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await pbkdf2(password, salt, ITERATIONS, HASH_BYTES);
  return `$pbkdf2-sha256$i=${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** Whether `password` is the one `digest` was made from. */
export async function verifyPassword(password: string, digest: string): Promise<boolean> {
  const [, iterations, salt, hash] = DIGEST.exec(digest) ?? [];
  const [saltBytes, hashBytes] = [fromBase64(salt ?? ""), fromBase64(hash ?? "")];
  if (!iterations || !saltBytes || !hashBytes?.length) return false;
  const candidate = await pbkdf2(password, saltBytes, Number(iterations), hashBytes.length);
  return crypto.subtle.timingSafeEqual(candidate, hashBytes);
}

/**
 * Hashes passwords where there's CPU time for it. A hash takes tens of milliseconds of CPU, and on
 * Workers Free a Worker's request gets 10 ms where a Durable Object's gets 30 seconds. It keeps
 * nothing, so each hash can run in a new object of its own, near the request and in nobody's way.
 */
export class PasswordHasher extends DurableObject<Env> {
  hash(password: string): Promise<string> {
    return hashPassword(password);
  }
}

/** A new object to hash a password in, near this request. */
export const passwordHasher = (env: Env) => env.PASSWORD_HASHER.get(env.PASSWORD_HASHER.newUniqueId());
