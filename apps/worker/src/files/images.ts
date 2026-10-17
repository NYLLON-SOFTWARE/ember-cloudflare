// The width and height Active Storage records for an image (`ImageAnalyzer::Vips#metadata`, which ember-rust
// ports in crates/storage/src/analyze.rs), read without libvips from the headers of JPEG, PNG, GIF, WebP, TIFF
// and HEIF files, AVIF and HEIC among them, as libvips 8.16's loaders for them read them.

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * The EXIF orientations `ImageAnalyzer::Vips::ROTATIONS` matches by libexif's names for them: "Top-right",
 * "Bottom-left", "Right-top" and "Left-bottom". Rails swaps those images' width and height, though 2 and 4
 * only mirror them, while 5 and 7, which turn them, aren't there.
 */
const SWAPPED = new Set([2, 4, 6, 8]);

/**
 * What Rails records for an image of type `contentType` whose file starts with `bytes`: its size, swapped as
 * its EXIF orientation says, or null where libvips can't read it. As with libvips, the bytes decide how it's
 * read, whichever image type it was identified as.
 */
export function imageSize(bytes: Uint8Array, contentType: string): ImageSize | null {
  if (!contentType.startsWith("image")) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (const read of FORMATS) {
    const header = attempt(() => read(view, bytes));
    if (!header) continue;
    const { width, height, orientation } = header;
    if (!(width > 0 && height > 0)) return null;
    return orientation !== null && SWAPPED.has(orientation) ? { width: height, height: width } : { width, height };
  }
  return null;
}

interface Header extends ImageSize {
  /** The EXIF orientation, where libvips finds one. */
  orientation: number | null;
}

/** `read()`, or null where it reads past the end, which `DataView`'s getters throw at. */
function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const ascii = (bytes: Uint8Array, at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));

/** libjpeg-turbo 2.1's frames: baseline, extended and progressive, Huffman or arithmetic coded. It refuses the others. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc9, 0xca]);

/** SOF0 to SOF15, which include JPG (C8), but not DHT (C4) or DAC (CC). */
const isFrameMarker = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc;

/** The segments libjpeg reads past on the way to a frame's scan: DHT, DAC, DQT, DNL, DRI, APP0 to APP15 and COM. */
const isSkippedSegment = (marker: number) =>
  marker === 0xc4 || marker === 0xcc || (marker >= 0xdb && marker <= 0xdd) || (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;

/**
 * A JPEG's markers, as libjpeg reads them up to the scan: the size from its one frame, and the orientation
 * from its last EXIF segment, the one libvips keeps. Any marker libjpeg refuses there, or an end before a
 * scan, makes it unreadable.
 */
function jpeg(view: DataView, bytes: Uint8Array): Header | null {
  if (view.getUint16(0) !== 0xffd8) return null;
  let size: ImageSize | null = null;
  let orientation: number | null = null;
  let at = 2;
  while (at + 1 < bytes.length) {
    // libjpeg skips anything but a marker, and the fill bytes before one.
    if (bytes[at] !== 0xff || bytes[at + 1] === 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1]!;
    at += 2;
    // A stuffed zero, a restart marker or TEM, none of which has a segment.
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (marker === 0xda) return size && { ...size, orientation };
    if (isFrameMarker(marker)) {
      if (size || !JPEG_FRAMES.has(marker)) return null;
      size = { height: view.getUint16(at + 3), width: view.getUint16(at + 5) };
    } else if (!isSkippedSegment(marker)) return null;
    const length = view.getUint16(at);
    if (length < 2) return null;
    if (marker === 0xe1 && ascii(bytes, at + 2, 6) === "Exif\0\0") orientation = exifOrientation(bytes.subarray(at + 8, at + length));
    at += length;
  }
  return null;
}

/** The largest width or height libspng takes. */
const MAX_PNG_SIDE = 2 ** 31 - 1;

/** A PNG's IHDR, which comes first, and an eXIf chunk before its image data, which libspng hands libvips. */
function png(view: DataView, bytes: Uint8Array): Header | null {
  if (ascii(bytes, 0, 8) !== "\x89PNG\r\n\x1a\n" || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) return null;
  let orientation: number | null = null;
  for (let at = 8; at + 8 <= bytes.length; at += 12 + view.getUint32(at)) {
    const type = ascii(bytes, at + 4, 4);
    if (type === "IDAT" || type === "IEND") break;
    if (type === "eXIf") orientation = exifOrientation(bytes.subarray(at + 8, at + 8 + view.getUint32(at)));
  }
  return { width, height, orientation };
}

/**
 * libnsgif's screen sizes that broken GIFs give, any 0, or more than 2,048 a side: for these it takes the
 * first frame's size instead.
 */
function isBrokenScreen(width: number, height: number): boolean {
  const size = `${width}x${height}`;
  return ["640x480", "640x512", "800x600", "1024x768", "1280x1024", "1600x1200"].includes(size) || width === 0 || height === 0 || width > 2048 || height > 2048;
}

/**
 * A GIF's size as libnsgif reckons it: its logical screen, grown to fit its first frame, or only that frame
 * where the screen is one broken GIFs give. A GIF with no frame is unreadable.
 */
function gif(view: DataView, bytes: Uint8Array): Header | null {
  const signature = ascii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  let width = view.getUint16(6, true);
  let height = view.getUint16(8, true);
  if (isBrokenScreen(width, height)) [width, height] = [1, 1];
  // Past the global color table, if it has one.
  const flags = view.getUint8(10);
  let at = 13 + (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0);
  // Past each extension: its introducer and label, then blocks of the length each starts with, up to an empty one.
  while (bytes[at] === 0x21) {
    at += 2;
    while (at < bytes.length && bytes[at] !== 0) at += bytes[at]! + 1;
    at++;
  }
  if (bytes[at] !== 0x2c) return null;
  const right = view.getUint16(at + 1, true) + view.getUint16(at + 5, true);
  const bottom = view.getUint16(at + 3, true) + view.getUint16(at + 7, true);
  return { width: Math.max(width, right), height: Math.max(height, bottom), orientation: null };
}

/** VP8X's flag for an EXIF chunk, without which libvips doesn't look for one. */
const WEBP_EXIF_FLAG = 0x08;

/** A WebP's canvas, from its first chunk, and with the extended format, its first EXIF chunk. */
function webp(view: DataView, bytes: Uint8Array): Header | null {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;
  switch (ascii(bytes, 12, 4)) {
    case "VP8 ":
      // A lossy key frame: its tag, its start code, then 14 bits each of width and height.
      if (view.getUint16(23) !== 0x9d01 || bytes[25] !== 0x2a) return null;
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, orientation: null };
    case "VP8L": {
      // A lossless image: its signature, then 14 bits each of width and height, less one.
      if (bytes[20] !== 0x2f) return null;
      const bits = view.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: null };
    }
    case "VP8X": {
      const width = (view.getUint32(24, true) & 0xffffff) + 1;
      const height = (view.getUint32(26, true) >>> 8) + 1;
      let orientation: number | null = null;
      if (view.getUint8(20) & WEBP_EXIF_FLAG) {
        for (let at = 12; at + 8 <= bytes.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2)) {
          if (ascii(bytes, at, 4) !== "EXIF") continue;
          const exif = bytes.subarray(at + 8, at + 8 + view.getUint32(at + 4, true));
          // libvips takes it with JPEG's "Exif" prefix or without.
          orientation = exifOrientation(ascii(exif, 0, 6) === "Exif\0\0" ? exif.subarray(6) : exif);
          break;
        }
      }
      return { width, height, orientation };
    }
    default:
      return null;
  }
}

/** A TIFF's first image's size. libvips gives Rails no EXIF orientation for a TIFF, so it's never swapped. */
function tiff(view: DataView, bytes: Uint8Array): Header | null {
  const ifd = firstIfd(view, bytes);
  if (!ifd) return null;
  const width = ifd.number(0x0100);
  const height = ifd.number(0x0101);
  return width === null || height === null ? null : { width, height, orientation: null };
}

/** The major brands libvips 8.16 opens a HEIF of (heifload.c's `heif_magic`). */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1", "avif"]);

/** The brands libheif 1.19, which libvips reads HEIFs with, opens a file that's compatible with one of. */
const LIBHEIF_BRANDS = ["heic", "heix", "mif1", "avif", "1pic", "jpeg"];

/** The item types libheif reads as images, besides a `mime` item that's a JPEG. */
const HEIF_IMAGES = new Set(["jpeg", "hvc1", "av01", "vvc1", "avc1", "unci", "j2k1", "mski", "grid", "iovl", "iden", "tili"]);

/** The most pixels libvips lets libheif open an image of: 16,384 squared, as heifsave writes at most. */
const MAX_HEIF_PIXELS = 0x4000 ** 2;

/** The largest `int`, which libheif takes for a side or a fraction's term. */
const MAX_INT = 2 ** 31 - 1;

/**
 * A HEIF's size as libvips reads it with libheif: its primary image's, from its properties, where that's one
 * of its top-level images, and otherwise the first of them, in the order of their ids. Those are the images
 * that aren't hidden, nor another image's thumbnail (`thmb`) or auxiliary image (`auxl`), such as its alpha
 * channel. A file libheif refuses, without the boxes it needs or with any image it can't read, is unreadable.
 */
function heif(view: DataView, bytes: Uint8Array): Header | null {
  // libvips takes an `ftyp` box of whole words with one of its major brands, and libheif one in its first
  // 1,024 bytes that's compatible with one of its own.
  const ftypSize = view.getUint32(0);
  if (ascii(bytes, 4, 4) !== "ftyp" || !HEIF_BRANDS.has(ascii(bytes, 8, 4)) || ftypSize % 4 || ftypSize < 16 || ftypSize > 1024) return null;
  const compatible = Array.from({ length: (ftypSize - 16) / 4 }, (_, n) => ascii(bytes, 16 + 4 * n, 4));
  if (!LIBHEIF_BRANDS.some((brand) => compatible.includes(brand))) return null;

  const meta = metaAfter(view, bytes, ftypSize);
  if (!meta || meta.view.getUint8(0) !== 0) return null;
  const children = [...boxesIn(meta.bytes, 4)];
  const [hdlr, pitm, iloc, iinf, iprp, iref] = ["hdlr", "pitm", "iloc", "iinf", "iprp", "iref"].map((type) => children.find((box) => box.type === type));
  if (hdlr && (hdlr.view.getUint8(0) !== 0 || hdlr.bytes.length < 24 || ascii(hdlr.bytes, 8, 4) !== "pict")) return null;
  if (!pitm || !iloc || !iinf || !iprp || pitm.view.getUint8(0) > 1) return null;
  const primary = pitm.view.getUint8(0) === 0 ? pitm.view.getUint16(4) : pitm.view.getUint32(4);
  const items = itemsOf(iinf);
  const images = [...items.keys()].filter((id) => isHeifImage(items.get(id)!)).sort((a, b) => a - b);
  if (!images.includes(primary) || items.get(primary)!.hidden) return null;

  const iprpChildren = [...boxesIn(iprp.bytes)];
  const ipco = iprpChildren.find((box) => box.type === "ipco");
  if (!ipco) return null;
  const properties = [...boxesIn(ipco.bytes)];
  const associations = associationsOf(iprpChildren.filter((box) => box.type === "ipma"));
  const sizes = new Map<number, Header>();
  for (const id of images) {
    const places = associations.get(id);
    if (!places || places.some((place) => place > properties.length)) return null;
    const size = sizeOf(places.filter((place) => place > 0).map((place) => properties[place - 1]!));
    if (!size) return null;
    sizes.set(id, size);
  }

  const references = iref ? referencesOf(iref) : [];
  const isBeneath = (id: number) => references.some(({ type, from, to }) => from === id && (type === "thmb" || (type === "auxl" && to.some((other) => sizes.has(other)))));
  const topLevel = images.filter((id) => !items.get(id)!.hidden && !isBeneath(id));
  const shown = topLevel.includes(primary) ? primary : topLevel[0];
  return shown === undefined ? null : sizes.get(shown)!;
}

/** An ISO base media file's box: its type and its contents, whose view throws at reading past their end. */
interface Box {
  type: string;
  bytes: Uint8Array;
  view: DataView;
}

/**
 * The box at `at` in `bytes`, whose size, where it's 1, follows its type in 64 bits, and where it's 0, runs
 * to the end. libheif refuses one that's smaller than its header or runs past the end.
 */
function boxAt(view: DataView, bytes: Uint8Array, at: number): Box | null {
  const size = view.getUint32(at);
  const [start, end] = size === 1 ? [at + 16, at + Number(view.getBigUint64(at + 8))] : [at + 8, size === 0 ? bytes.length : at + size];
  if (end < start || end > bytes.length) return null;
  const contents = bytes.subarray(start, end);
  return { type: ascii(bytes, at + 4, 4), bytes: contents, view: new DataView(contents.buffer, contents.byteOffset, contents.byteLength) };
}

/** The boxes in `bytes` from `at`, each in turn. */
function* boxesIn(bytes: Uint8Array, at = 0): Generator<Box> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at < bytes.length) {
    const box = boxAt(view, bytes, at);
    if (!box) throw new RangeError("A box runs past its parent");
    yield box;
    at = box.bytes.byteOffset - bytes.byteOffset + box.bytes.length;
  }
}

/**
 * The `meta` box libheif finds by skipping from box to box after the `ftyp` box at the start, which it
 * does while one starts at least 32 bytes before the end.
 */
function metaAfter(view: DataView, bytes: Uint8Array, at: number): Box | null {
  while (at + 32 <= bytes.length) {
    if (view.getUint32(at) === 0) return null;
    // Past the end, and smaller than its header, only a `meta` box is refused, but no other box could be read after it.
    const box = boxAt(view, bytes, at);
    if (!box) return null;
    if (box.type === "meta") return box;
    at = box.bytes.byteOffset - bytes.byteOffset + box.bytes.length;
  }
  return null;
}

/** An item of a HEIF's: its type, whether it's hidden, and a `mime` item's content type. */
interface Item {
  type: string;
  hidden: boolean;
  contentType?: string;
}

/** The items an `iinf` box lists, as many as it says it has, by their ids, the first for each id. */
function itemsOf({ bytes, view }: Box): Map<number, Item> {
  const items = new Map<number, Item>();
  const wide = view.getUint8(0) !== 0;
  const count = wide ? view.getUint32(4) : view.getUint16(4);
  const listed = boxesIn(bytes, wide ? 8 : 6);
  for (let n = 0; n < count; n++) {
    const next = listed.next();
    if (next.done) break;
    if (next.value.type !== "infe") continue;
    const infe = next.value;
    const version = infe.view.getUint8(0);
    if (version > 3) throw new RangeError(`An infe box of version ${version}`);
    const id = version === 3 ? infe.view.getUint32(4) : infe.view.getUint16(4);
    // Before version 2, an item has no type, so it's no image.
    const type = version < 2 ? "" : ascii(infe.bytes, version === 3 ? 10 : 8, 4);
    // Past its name, a `mime` item's content type.
    const afterName = version < 2 ? 0 : cString(infe.bytes, version === 3 ? 14 : 12)[1];
    const contentType = type === "mime" ? cString(infe.bytes, afterName)[0] : undefined;
    if (!items.has(id)) items.set(id, { type, hidden: version >= 2 && (infe.view.getUint32(0) & 1) === 1, contentType });
  }
  return items;
}

/** The NUL-terminated string at `at` and where the next starts, as libheif reads one: empty at the end, refused where it runs past it. */
function cString(bytes: Uint8Array, at: number): [string, number] {
  if (at >= bytes.length) return ["", bytes.length];
  const length = bytes.subarray(at).indexOf(0);
  if (length < 0) throw new RangeError("A string runs past its box");
  return [ascii(bytes, at, length), at + length + 1];
}

/** Whether libheif reads `item` as an image. */
const isHeifImage = ({ type, contentType }: Item) => HEIF_IMAGES.has(type) || (type === "mime" && contentType === "image/jpeg");

/** An `iref` box's references, each from one item to others, which libheif reads one after another, past each one's header. */
function referencesOf({ bytes, view }: Box): Array<{ type: string; from: number; to: number[] }> {
  const version = view.getUint8(0);
  if (version > 1) throw new RangeError(`An iref box of version ${version}`);
  const [idOf, idSize] = version === 0 ? [(at: number) => view.getUint16(at), 2] : [(at: number) => view.getUint32(at), 4];
  const references = [];
  for (let at = 4; at < bytes.length; ) {
    const type = ascii(bytes, at + 4, 4);
    at += view.getUint32(at) === 1 ? 16 : 8;
    const from = idOf(at);
    const count = view.getUint16(at + idSize);
    if (count === 0) throw new RangeError("A reference to nothing");
    at += idSize + 2;
    references.push({ type, from, to: Array.from({ length: count }, (_, n) => idOf(at + n * idSize)) });
    at += count * idSize;
  }
  return references;
}

/** Each item's properties, by their places in `ipco` counting from 1, from its first entry in the `ipma` boxes. */
function associationsOf(ipmas: Box[]): Map<number, number[]> {
  const items = new Map<number, number[]>();
  for (const { view } of ipmas) {
    const version = view.getUint8(0);
    if (version > 1) throw new RangeError(`An ipma box of version ${version}`);
    // Its flags say whether each place takes 15 bits or 7, after a bit saying whether it's essential.
    const wide = (view.getUint32(0) & 1) === 1;
    const count = view.getUint32(4);
    for (let at = 8, entry = 0; entry < count && at < view.byteLength; entry++) {
      const id = version === 0 ? view.getUint16(at) : view.getUint32(at);
      at += version === 0 ? 2 : 4;
      const places: number[] = [];
      for (let left = view.getUint8(at++); left > 0; left--, at += wide ? 2 : 1) places.push(wide ? view.getUint16(at) & 0x7fff : view.getUint8(at) & 0x7f);
      if (!items.has(id)) items.set(id, places);
    }
  }
  return items;
}

/**
 * The size of an image with `properties`: its extents (`ispe`), set to the clean aperture (`clap`) it's
 * cropped to, and swapped for a rotation (`irot`) of 90° or 270°, as its properties come, in their order.
 * libheif turns or mirrors (`imir`) only an image with extents. libvips drops a HEIF's EXIF orientation,
 * so it's never swapped.
 */
function sizeOf(properties: Box[]): Header | null {
  let size = { width: 0, height: 0 };
  let extents = false;
  for (const { type, view } of properties) {
    if (type !== "ispe") continue;
    if (view.getUint8(0) !== 0) return null;
    const [width, height] = [view.getUint32(4), view.getUint32(8)];
    if (!width || !height || width > MAX_INT || height > MAX_INT || width * height > MAX_HEIF_PIXELS) return null;
    [size, extents] = [{ width, height }, true];
  }
  for (const { type, view } of properties) {
    if (type === "clap") {
      const aperture = cleanAperture(view);
      if (!aperture) return null;
      size = aperture;
    } else if (type === "irot" || type === "imir") {
      // Its byte's lowest bits turn it by quarters, or say which way to mirror it.
      const turned = type === "irot" && (view.getUint8(0) & 1) === 1;
      if ((turned || type === "imir") && !extents) return null;
      if (turned) size = { width: size.height, height: size.width };
    }
  }
  return { ...size, orientation: null };
}

/** libheif's largest term of a fraction, which it halves both terms of until neither is larger. */
const MAX_FRACTION = 0x10000;

/** A `clap` box's width and height, rounded as libheif rounds them, or null where libheif refuses it. */
function cleanAperture(view: DataView): ImageSize | null {
  const term = (n: number) => view.getUint32(4 * n);
  const [width, widthOver, height, heightOver, leftOver, topOver] = [term(0), term(1), term(2), term(3), term(5), term(7)];
  if ([width, widthOver, height, heightOver, leftOver, topOver].some((value) => value > MAX_INT)) return null;
  if ([widthOver, heightOver, leftOver, topOver].includes(0)) return null;
  return { width: rounded(width, widthOver), height: rounded(height, heightOver) };
}

/** `numerator / denominator` to the nearest whole number, halves up, once libheif has halved its terms. */
function rounded(numerator: number, denominator: number): number {
  while (denominator > MAX_FRACTION || (denominator > 1 && numerator > MAX_FRACTION)) {
    numerator = Math.trunc(numerator / 2);
    denominator = Math.trunc(denominator / 2);
  }
  return Math.trunc((numerator + Math.trunc(denominator / 2)) / denominator);
}

/** The orientation in `exif`, a TIFF structure as EXIF keeps one, where libexif can read one. */
function exifOrientation(exif: Uint8Array): number | null {
  const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength);
  return attempt(() => firstIfd(view, exif)?.short(0x0112) ?? null);
}

const SHORT = 3;
const LONG = 4;

/** A TIFF structure's first image file directory, for the one number an entry holds, by its tag and type. */
function firstIfd(view: DataView, bytes: Uint8Array) {
  const order = ascii(bytes, 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const little = order === "II";
  if (view.getUint16(2, little) !== 42) return null;
  const at = view.getUint32(4, little);
  const count = view.getUint16(at, little);
  /** The first entry for `tag`'s number, if it holds one number of one of `types`. */
  const value = (tag: number, types: number[]) => {
    for (let entry = at + 2; entry < at + 2 + 12 * count; entry += 12) {
      if (view.getUint16(entry, little) !== tag) continue;
      const type = view.getUint16(entry + 2, little);
      if (!types.includes(type) || view.getUint32(entry + 4, little) !== 1) return null;
      return type === SHORT ? view.getUint16(entry + 8, little) : view.getUint32(entry + 8, little);
    }
    return null;
  };
  return { short: (tag: number) => value(tag, [SHORT]), number: (tag: number) => value(tag, [SHORT, LONG]) };
}

/** Each format libvips reads here, whose signatures never overlap. */
const FORMATS = [jpeg, png, gif, webp, tiff, heif];
