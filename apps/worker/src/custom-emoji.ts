import {
  CUSTOM_EMOJI_API_PATH,
  CUSTOM_EMOJI_NAME_IS_STANDARD,
  CUSTOM_EMOJI_NAME_TAKEN,
  CUSTOM_EMOJI_TOO_LARGE,
  CUSTOM_EMOJI_TYPES,
  CUSTOM_EMOJI_WRONG_TYPE,
  customEmojiNameProblem,
  MAX_CUSTOM_EMOJI_SIZE,
  TOO_MANY_CUSTOM_EMOJI,
  type CustomEmoji,
  type CustomEmojiList,
} from "@ember/protocol";
import { credentialsOf } from "./auth";
import { EMOJI } from "./bots/emoji-names";
import type { Env } from "./env";
import { notFound } from "./error-pages";
import { etagOf, isFresh } from "./etag";
import { byMagic } from "./files/marcel";
import { pictureFormOf, type PictureRefusal } from "./files/pictures";
import { hasBody } from "./files/serving";
import { NO_STORAGE } from "./files/uploads";
import { base36 } from "./ids";
import { empty, signInFirst } from "./pages";
import { workspace } from "./workspace";

// Custom emoji, as Slack has them: anyone signed in adds one, a picture and a name, and removes their
// own, as administrators remove anyone's. R2 keeps each picture as it came, under a key of its own that
// is never used again, so a browser keeps its copy for good.

const NOT_SIGNED_IN = "Not signed in";

/** A picture's key never names another, so a copy is good for a year, in the browser of whoever signed in for it. */
const CACHE_CONTROL = "max-age=31536000, private, immutable";

/** `/emoji/<key>`, a key being what `newKey` makes. */
const ROUTE = /^\/emoji\/([0-9a-z]{28})$/;

const newKey = () => base36(28);

/** Where R2 keeps the picture whose key is `key`. */
export const customEmojiObject = (key: string) => `emoji/${key}`;

const problem = (status: number, message: string, field?: string) => Response.json({ error: message, ...(field ? { field } : {}) }, { status });

/** The key in a custom emoji's picture's path, or null if `pathname` isn't one. */
export const customEmojiKeyOf = (pathname: string): string | null => pathname.match(ROUTE)?.[1] ?? null;

/** Whether `name` is one of the emoji's own codes, as Slack names them, which no custom emoji takes. */
const isStandardName = (name: string) => Object.hasOwn(EMOJI, name);

/**
 * `GET /emoji/<key>`: a custom emoji's picture, for people signed in, as its bytes said what it is when it
 * was added. Signed out, the browser is sent to sign in; a key R2 has nothing at is an empty 404.
 */
export async function showCustomEmoji(request: Request, env: Env, key: string): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return notFound(request);
  const credentials = await credentialsOf(request, env);
  if (!credentials || !(await workspace(env).authenticate(credentials))) return signInFirst(request);
  if (!env.FILES) return empty(404);
  const etag = await etagOf(key);
  const headers = new Headers({ ETag: etag, "Cache-Control": CACHE_CONTROL });
  if (isFresh(request, etag)) return new Response(null, { status: 304, headers });
  const object = request.method === "HEAD" ? await env.FILES.head(customEmojiObject(key)) : await env.FILES.get(customEmojiObject(key));
  const contentType = object?.httpMetadata?.contentType;
  if (!object || !contentType || !CUSTOM_EMOJI_TYPES.includes(contentType)) return empty(404);
  headers.set("Content-Type", contentType);
  headers.set("Content-Length", String(object.size));
  return new Response(hasBody(object) ? object.body : null, { headers });
}

/** `GET /api/emoji`: every custom emoji, by name, for anyone signed in. */
export async function listCustomEmoji(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const emoji = credentials && (await workspace(env).customEmoji(credentials));
  if (!emoji) return problem(401, NOT_SIGNED_IN);
  return Response.json({ emoji } satisfies CustomEmojiList);
}

/** A custom emoji's picture as a form brings it: its bytes, and the type they say it is. */
interface EmojiPicture {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * The picture a form brings as its `image`, or why it's refused: a PNG, JPEG, GIF or WebP, by its bytes,
 * of up to 256 KB. The uploader's browser scales it to fit Slack's 128×128 first, but for a GIF, which
 * may be animated, so whatever comes is kept as it is, and the app draws it at an emoji's size.
 */
async function pictureOf(form: FormData): Promise<EmojiPicture | PictureRefusal> {
  const file = form.get("image");
  if (!(file instanceof File)) return { status: 400, error: "Choose an image" };
  if (file.size > MAX_CUSTOM_EMOJI_SIZE) return { status: 413, error: CUSTOM_EMOJI_TOO_LARGE };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = byMagic(bytes) ?? "";
  return CUSTOM_EMOJI_TYPES.includes(contentType) ? { bytes, contentType } : { status: 415, error: CUSTOM_EMOJI_WRONG_TYPE };
}

/**
 * `POST /api/emoji`: adds the custom emoji a form brings as its `name` and `image`, as whoever's signed
 * in, answering it with 201. Who's asking is checked before the form is read. The name is refused with a
 * 422 if it isn't one a custom emoji can have, or is one of the emoji's own, and with a 409 if another
 * custom emoji has it. The Workspace reserves the picture's key with the name, before R2 stores it, so R2
 * deletes a picture that never became an emoji, however the request ends.
 */
export async function addCustomEmoji(request: Request, env: Env): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  if (!credentials || !(await workspace(env).authenticate(credentials))) return problem(401, NOT_SIGNED_IN);
  if (!env.FILES) return problem(503, NO_STORAGE);
  const form = await pictureFormOf(request, CUSTOM_EMOJI_TOO_LARGE);
  if (!(form instanceof FormData)) return problem(form.status, form.error);
  const name = form.get("name");
  if (typeof name !== "string") return problem(422, "Give the emoji a name", "name");
  const refused = isStandardName(name) ? CUSTOM_EMOJI_NAME_IS_STANDARD : customEmojiNameProblem(name);
  if (refused) return problem(422, refused, "name");
  const picture = await pictureOf(form);
  if ("error" in picture) return problem(picture.status, picture.error);

  const key = newKey();
  const reserved = await workspace(env).reserveCustomEmoji(credentials, name, customEmojiObject(key));
  if (reserved !== "reserved") return unavailable(reserved);
  await env.FILES.put(customEmojiObject(key), picture.bytes, { httpMetadata: { contentType: picture.contentType } });
  const added = await workspace(env).addCustomEmoji(credentials, name, key, customEmojiObject(key), picture.contentType);
  if (typeof added === "string" || added === null) return unavailable(added);
  return Response.json(added satisfies CustomEmoji, { status: 201 });
}

/** Why a custom emoji can't be added now. */
function unavailable(reason: "taken" | "full" | null): Response {
  if (reason === null) return problem(401, NOT_SIGNED_IN);
  return reason === "taken" ? problem(409, CUSTOM_EMOJI_NAME_TAKEN, "name") : problem(422, TOO_MANY_CUSTOM_EMOJI);
}

/** The name in the address of one custom emoji, `/api/emoji/<name>`, or null if `pathname` isn't one. */
export function customEmojiNameOfPath(pathname: string): string | null {
  if (!pathname.startsWith(`${CUSTOM_EMOJI_API_PATH}/`)) return null;
  try {
    return decodeURIComponent(pathname.slice(CUSTOM_EMOJI_API_PATH.length + 1));
  } catch {
    // Malformed percent-encoding names none.
    return "";
  }
}

/**
 * `DELETE /api/emoji/<name>`: removes a custom emoji, answering 204: whoever added it can, and
 * administrators. Anyone else hears 403, and a name no custom emoji has, 404.
 */
export async function removeCustomEmoji(request: Request, env: Env, name: string): Promise<Response> {
  const credentials = await credentialsOf(request, env);
  const removed = credentials && (await workspace(env).removeCustomEmoji(credentials, name));
  if (!removed) return problem(401, NOT_SIGNED_IN);
  if (removed === "forbidden") return problem(403, "Only administrators can remove an emoji someone else added");
  return removed === "not found" ? problem(404, "No custom emoji has that name") : empty(204);
}
