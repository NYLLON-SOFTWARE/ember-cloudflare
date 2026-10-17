import { AVATAR_BOX, AVATAR_TOO_LARGE, isVariable, MAX_AVATAR_SIZE } from "@ember/protocol";
import { base36 } from "../ids";
import { sanitizedFilename } from "./filename";
import { imageSize } from "./images";
import { byMagic, identify } from "./marcel";

// Pictures people upload of themselves: avatars, from the profile, setup and sign-up forms. As
// ember-rust attaches one with Active Storage, R2 keeps the file as it came, whatever it is, under a key
// of its own, and beside it the variant ember-rust serves, which the uploader's browser makes where
// ember-rust makes it with libvips: within 512×512, keeping its proportions, as `resize_to_limit` scales
// it. A file ember-rust can't resize keeps no variant, and its owner's initials are served for it.

/**
 * The types a variant can be, by its bytes: WebP, or where the browser can't encode WebP, as Safari
 * can't, a PNG, or a JPEG for a picture that can't be see-through, as previews are made.
 */
const VARIANT_TYPES = new Set(["image/webp", "image/png", "image/jpeg"]);

/** How many bytes a request with a picture may bring: the largest picture, its variant and the rest of its form. */
export const MAX_PICTURE_REQUEST = MAX_AVATAR_SIZE + 2 * 1024 * 1024;

/** How much of a file is read to tell what it is: more than Marcel's magic looks at, which is the first 64 KiB. */
const SNIFFED_BYTES = 128 * 1024;

/** A picture as R2 keeps it: the key of its file, and its variant's type, or null when there's none. */
export interface StoredPicture {
  key: string;
  variant: string | null;
}

/** A picture as a form brings it: its file, the type its bytes say it is, and the variant to keep of it. */
export interface PictureUpload {
  file: File;
  contentType: string;
  variant: { bytes: Uint8Array; contentType: string } | null;
}

/** Why a picture is refused, and the status that says so. */
export interface PictureRefusal {
  status: number;
  error: string;
}

/**
 * The form a request brings a picture in, or why it's refused: without the request's length, past the
 * most a request with a picture may bring, or anything but a form.
 */
export async function pictureFormOf(request: Request): Promise<FormData | PictureRefusal> {
  const length = Number(request.headers.get("Content-Length") ?? Number.NaN);
  if (!Number.isSafeInteger(length)) return { status: 411, error: "A picture needs its Content-Length" };
  if (length > MAX_PICTURE_REQUEST) return { status: 413, error: AVATAR_TOO_LARGE };
  return (await request.formData().catch(() => null)) ?? { status: 400, error: "Expected a form" };
}

/** A new key for an avatar, as Active Storage gives a blob a key. */
export const newAvatarKey = () => `avatars/${base36(28)}`;

/** Where R2 keeps the variant of the picture at `key`. */
export const variantKey = (key: string) => `${key}/${AVATAR_BOX}`;

/** Everything R2 keeps for the picture at `key`, which deleting it deletes. */
export const pictureObjects = (key: string) => [key, variantKey(key)];

/**
 * The avatar a form brings as its `avatar` and `variant` parts, or why it's refused: any file up to
 * 16 MB, as ember-rust takes a file of any type, and a WebP, PNG or JPEG within 512×512 as its variant.
 * The variant is kept only for a file ember-rust can resize, by what its bytes say it is, so a picture
 * of a type ember-rust can't resize, such as an SVG or a BMP, is served as its owner's initials.
 */
export async function avatarOf(form: FormData): Promise<PictureUpload | PictureRefusal> {
  const file = form.get("avatar");
  if (!(file instanceof File)) return { status: 400, error: "Choose a picture" };
  if (file.size > MAX_AVATAR_SIZE) return { status: 413, error: AVATAR_TOO_LARGE };
  const sniffed = new Uint8Array(await file.slice(0, SNIFFED_BYTES).arrayBuffer());
  const contentType = identify(sniffed, sanitizedFilename(file.name), file.type);

  const sent = form.get("variant");
  if (sent === null) return { file, contentType, variant: null };
  if (!(sent instanceof File)) return { status: 400, error: "A variant is a picture" };
  const bytes = new Uint8Array(await sent.arrayBuffer());
  const variantType = byMagic(bytes) ?? "";
  const size = VARIANT_TYPES.has(variantType) ? imageSize(bytes, variantType) : null;
  if (!size) return { status: 415, error: "A variant is a WebP, PNG or JPEG image" };
  if (size.width > AVATAR_BOX || size.height > AVATAR_BOX) return { status: 422, error: `A variant fits within ${AVATAR_BOX}×${AVATAR_BOX}` };
  return { file, contentType, variant: isVariable(contentType) ? { bytes, contentType: variantType } : null };
}

/** Has R2 keep `picture` at `key`, its variant beside it, answering it as stored. */
export async function storePicture(files: R2Bucket, key: string, { file, contentType, variant }: PictureUpload): Promise<StoredPicture> {
  await Promise.all([
    files.put(key, file, { httpMetadata: { contentType } }),
    variant && files.put(variantKey(key), variant.bytes, { httpMetadata: { contentType: variant.contentType } }),
  ]);
  return { key, variant: variant?.contentType ?? null };
}
