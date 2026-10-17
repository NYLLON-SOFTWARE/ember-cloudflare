// The width and height Active Storage records for an image (`ImageAnalyzer::Vips#metadata`, which ember-rust
// ports in crates/storage/src/analyze.rs), read without libvips from the headers of the formats browsers show:
// JPEG, PNG, GIF, WebP and TIFF, as libvips 8.16's loaders for them read them.

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
const FORMATS = [jpeg, png, gif, webp, tiff];
