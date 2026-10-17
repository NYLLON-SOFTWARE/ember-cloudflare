import { toBase64url } from "../encoding";
import { escapePath } from "./filename";

// The addresses that show and download a room's files, /files/<key>/<signature>/<name>, as ember-rust's
// signed blob links give them out (crates/ember/src/active_storage.rs): the signature says Ember made
// the address, so nobody can guess one, and as there, it never expires. The name is there for whoever
// saves the file, but what it's saved as is the name Ember keeps.

const encoder = new TextEncoder();

/** How much of its HMAC a signature keeps, as avatar tokens keep. */
const SIGNATURE_BYTES = 16;

/**
 * The signature of file `key` under SESSION_SECRET: the first 16 bytes of its HMAC, as base64url.
 * Changing the secret changes them all, as changing ember-rust's `SECRET_KEY_BASE` does.
 */
async function signature(secret: string, key: string): Promise<string> {
  const hmac = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", hmac, encoder.encode(`file:${key}`));
  return toBase64url(new Uint8Array(signed, 0, SIGNATURE_BYTES));
}

/** Whether `given` is file `key`'s signature under `secret`. */
export async function isFileSignature(secret: string, key: string, given: string): Promise<boolean> {
  const [a, b] = [encoder.encode(given), encoder.encode(await signature(secret, key))];
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

/**
 * The address that shows file `key`, named `name`, which Active Storage's routes escape as a path, and
 * the one that downloads it, which asks for it as an attachment.
 */
export async function fileUrls(secret: string, key: string, name: string): Promise<{ url: string; downloadUrl: string }> {
  const url = `/files/${key}/${await signature(secret, key)}/${escapePath(name)}`;
  return { url, downloadUrl: `${url}?disposition=attachment` };
}
