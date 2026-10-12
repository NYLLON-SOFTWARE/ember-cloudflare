import type { User } from "@ember/protocol";

// A stateless session token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
// It is a placeholder for real accounts; it proves only that this Worker issued the name.

interface Payload extends User {
  iat: number;
}

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error("SESSION_SECRET is not set. Copy apps/worker/.dev.vars.example to .dev.vars.");
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function issueToken(user: User, secret: string, now = Date.now()): Promise<string> {
  const payload: Payload = { ...user, iat: Math.floor(now / 1000) };
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(signature))}`;
}

export async function verifyToken(token: string, secret: string, now = Date.now()): Promise<User | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const hmac = await key(secret);
  try {
    const valid = await crypto.subtle.verify("HMAC", hmac, fromBase64url(signature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Payload;
    if (now / 1000 - payload.iat > MAX_AGE_SECONDS) return null;
    return { id: payload.id, name: payload.name };
  } catch {
    return null;
  }
}
