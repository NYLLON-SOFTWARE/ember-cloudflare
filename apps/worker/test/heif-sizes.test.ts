// The sizes recorded for AVIF and HEIC files are the ones ember-rust's libvips 8.16.1 reads with libheif
// 1.19.8, as Debian 13 packages them (its Dockerfile). Later versions of libheif read a few of these files
// differently, as the tests say where.
import { feature } from "@ember/parity";
import { describe, expect, it } from "vitest";
import { metadataOf } from "../src/files/uploads";
import { alpha, av1C, clap, exifOrientation, type HeifFile, heifFile, hvcC, imir, irot, ispe } from "./heif-files";

/** The width and height recorded for `file`, or null where none is. */
function recordedSize(file: HeifFile | Uint8Array, contentType = "image/avif") {
  const { width, height } = JSON.parse(metadataOf(file instanceof Uint8Array ? file : heifFile(file), contentType)) as { width?: number; height?: number };
  return width === undefined ? null : { width, height };
}

/** An AV1 image's properties: its configuration and its extents, then `more`. */
const image = (width: number, height: number, ...more: Uint8Array[]) => [av1C, ispe(width, height), ...more];

/** An AVIF of one image, `width` by `height`, with `more` properties. */
const avif = (width: number, height: number, ...more: Uint8Array[]): HeifFile => ({ items: [{ id: 1, properties: image(width, height, ...more) }] });

describe(feature("attachments.types"), () => {
  it("records an AVIF's or a HEIC's size from its image's extents, without reading its picture", () => {
    expect(metadataOf(heifFile(avif(1200, 800)), "image/avif")).toBe('{"identified":true,"width":1200,"height":800,"analyzed":true}');
    const heic = heifFile({ brand: "heic", compatible: ["mif1", "heic"], items: [{ id: 1, type: "hvc1", properties: [hvcC, ispe(4032, 3024)] }] });
    expect(recordedSize(heic, "image/heic")).toEqual({ width: 4032, height: 3024 });
    // With the pictures before the boxes describing them, and with ids and places of properties that take more bits.
    expect(recordedSize({ ...avif(1200, 800), dataFirst: true })).toEqual({ width: 1200, height: 800 });
    expect(recordedSize({ wide: true, items: [{ id: 70000, properties: image(1200, 800) }] })).toEqual({ width: 1200, height: 800 });
  });

  it("records the size of an image of up to 16,384 squared pixels, the most libvips lets libheif open", () => {
    expect(recordedSize(avif(16384, 16384))).toEqual({ width: 16384, height: 16384 });
    expect(recordedSize(avif(65536, 4096))).toEqual({ width: 65536, height: 4096 });
    // Later versions of libheif read these sizes too.
    expect(recordedSize(avif(16385, 16384))).toBeNull();
    expect(recordedSize(avif(65537, 4096))).toBeNull();
    expect(recordedSize(avif(0, 800))).toBeNull();
    expect(recordedSize(avif(2 ** 31, 1))).toBeNull();
  });

  it("swaps the width and height for a rotation by 90° or 270°, though not for a mirroring", () => {
    expect(recordedSize(avif(1200, 800, irot(1)))).toEqual({ width: 800, height: 1200 });
    expect(recordedSize(avif(1200, 800, irot(2)))).toEqual({ width: 1200, height: 800 });
    expect(recordedSize(avif(1200, 800, irot(3)))).toEqual({ width: 800, height: 1200 });
    // Only the rotation's lowest two bits count.
    expect(recordedSize(avif(1200, 800, irot(5)))).toEqual({ width: 800, height: 1200 });
    expect(recordedSize(avif(1200, 800, imir(1)))).toEqual({ width: 1200, height: 800 });
  });

  it("crops the size to a clean aperture, rounding its fractions as libheif does", () => {
    expect(recordedSize(avif(1200, 800, clap([1000, 1], [700, 1])))).toEqual({ width: 1000, height: 700 });
    expect(recordedSize(avif(1200, 800, clap([47, 2], [45, 2])))).toEqual({ width: 24, height: 23 });
    expect(recordedSize(avif(1200, 800, clap([7, 3], [8, 3])))).toEqual({ width: 2, height: 3 });
    // libheif halves both terms of a fraction until neither is larger than 65,536, or its denominator is 1.
    expect(recordedSize(avif(1200, 800, clap([98305, 65537], [700, 1])))).toEqual({ width: 2, height: 700 });
    expect(recordedSize(avif(1200, 800, clap([200000, 3], [700, 1])))).toEqual({ width: 100000, height: 700 });
    // A crop to nothing, or one libheif refuses, leaves the image unreadable.
    expect(recordedSize(avif(1200, 800, clap([1, 3], [700, 1])))).toBeNull();
    expect(recordedSize(avif(1200, 800, clap([1000, 1], [3, 65537])))).toBeNull();
    expect(recordedSize(avif(1200, 800, clap([1000, 0], [700, 1])))).toBeNull();
    expect(recordedSize(avif(1200, 800, clap([2 ** 31, 1], [700, 1])))).toBeNull();
  });

  it("crops and turns the size in the order of the image's properties, from its last extents", () => {
    expect(recordedSize(avif(1200, 800, clap([1000, 1], [700, 1]), irot(1)))).toEqual({ width: 700, height: 1000 });
    expect(recordedSize(avif(1200, 800, irot(1), clap([1000, 1], [700, 1])))).toEqual({ width: 1000, height: 700 });
    expect(recordedSize(avif(1200, 800, ispe(640, 480)))).toEqual({ width: 640, height: 480 });
  });

  it("needs an image's extents for its size, and for any rotation by a quarter or mirroring", () => {
    expect(recordedSize({ items: [{ id: 1, properties: [av1C] }] })).toBeNull();
    expect(recordedSize({ items: [{ id: 1, properties: [av1C, clap([1000, 1], [700, 1])] }] })).toEqual({ width: 1000, height: 700 });
    expect(recordedSize({ items: [{ id: 1, properties: [av1C, irot(2), clap([1000, 1], [700, 1])] }] })).toEqual({ width: 1000, height: 700 });
    expect(recordedSize({ items: [{ id: 1, properties: [av1C, irot(1)] }] })).toBeNull();
    expect(recordedSize({ items: [{ id: 1, properties: [av1C, imir(), clap([1000, 1], [700, 1])] }] })).toBeNull();
    // A rotation with no angle.
    expect(recordedSize({ items: [{ id: 1, properties: [av1C, ispe(1200, 800), Uint8Array.of(0, 0, 0, 8, ...new TextEncoder().encode("irot"))] }] })).toBeNull();
  });

  it("never swaps the width and height for an EXIF orientation, which libvips drops from a HEIF", () => {
    const exif = { id: 2, type: "Exif", data: exifOrientation(6) };
    const references = [{ type: "cdsc", from: 2, to: [1] }];
    expect(recordedSize({ items: [{ id: 1, properties: image(1200, 800) }, exif], references })).toEqual({ width: 1200, height: 800 });
    expect(recordedSize({ items: [{ id: 1, properties: image(1200, 800) }, exif], references, dataFirst: true })).toEqual({ width: 1200, height: 800 });
  });

  it("records the primary image's size, or where that's another's thumbnail or alpha channel, the first other image's", () => {
    expect(recordedSize({ primary: 2, items: [{ id: 1, properties: image(640, 480) }, { id: 2, properties: image(1200, 800) }] })).toEqual({ width: 1200, height: 800 });
    const thumbnail = { primary: 2, items: [{ id: 1, properties: image(1200, 800) }, { id: 2, properties: image(240, 160) }], references: [{ type: "thmb", from: 2, to: [1] }] };
    expect(recordedSize(thumbnail)).toEqual({ width: 1200, height: 800 });
    const images = [{ id: 1, properties: image(240, 160) }, { id: 2, properties: image(1200, 800) }, { id: 3, properties: image(640, 480) }];
    expect(recordedSize({ items: images, references: [{ type: "thmb", from: 1, to: [2] }] })).toEqual({ width: 1200, height: 800 });
    const withAlpha = [{ id: 1, properties: image(1200, 800) }, { id: 2, properties: image(1200, 800, alpha) }];
    expect(recordedSize({ items: withAlpha, references: [{ type: "auxl", from: 2, to: [1] }] })).toEqual({ width: 1200, height: 800 });
    const alphaFirst = [{ id: 1, properties: image(600, 400, alpha) }, { id: 2, properties: image(1200, 800) }];
    expect(recordedSize({ primary: 2, items: alphaFirst, references: [{ type: "auxl", from: 1, to: [2] }] })).toEqual({ width: 1200, height: 800 });
  });

  it("records nothing for a file whose primary item is hidden, isn't an image or isn't there", () => {
    expect(recordedSize({ items: [{ id: 1, hidden: true, properties: image(1200, 800) }] })).toBeNull();
    expect(recordedSize({ primary: 2, items: [{ id: 1, properties: image(1200, 800) }, { id: 2, type: "Exif", data: exifOrientation(1) }] })).toBeNull();
    expect(recordedSize({ primary: 9, items: [{ id: 1, properties: image(1200, 800) }] })).toBeNull();
  });

  it("records nothing for a file with an image libheif can't open, though it isn't the one shown", () => {
    // libheif 1.19 checks every image as it reads a file. Later versions read these sizes.
    expect(recordedSize({ items: [{ id: 1, properties: image(1200, 800) }, { id: 2, hidden: true, properties: image(20000, 20000) }] })).toBeNull();
    expect(recordedSize({ items: [{ id: 1, properties: image(1200, 800) }, { id: 2, hidden: true }] })).toBeNull();
  });

  it("reads the major brands libvips 8.16 takes, of files compatible with a brand libheif takes", () => {
    expect(recordedSize({ ...avif(1200, 800), brand: "mif1", compatible: ["mif1"] })).toEqual({ width: 1200, height: 800 });
    // An image sequence's brand, of a file later versions of libheif refuse.
    const sequence = { brand: "msf1", compatible: ["msf1", "hevc", "heic", "mif1"], items: [{ id: 1, type: "hvc1", properties: [hvcC, ispe(1200, 800)] }] };
    expect(recordedSize(sequence, "image/heif-sequence")).toEqual({ width: 1200, height: 800 });
    expect(recordedSize({ ...avif(1200, 800), brand: "avis", compatible: ["avis", "avif", "mif1", "miaf"] })).toBeNull();
    expect(recordedSize({ ...avif(1200, 800), brand: "miaf" })).toBeNull();
    expect(recordedSize({ ...avif(1200, 800), compatible: ["miaf", "MA1B"] })).toBeNull();
  });

  it("reads an ftyp box of whole words, of up to 1,024 bytes", () => {
    expect(recordedSize({ ...avif(1200, 800), compatible: ["avif", "mif1", "mi"] })).toBeNull();
    expect(recordedSize({ ...avif(1200, 800), compatible: ["avif", ...Array<string>(251).fill("abcd")] })).toEqual({ width: 1200, height: 800 });
    expect(recordedSize({ ...avif(1200, 800), compatible: ["avif", ...Array<string>(252).fill("abcd")] })).toBeNull();
  });

  it("needs the boxes listing a file's items, their places and properties, and which is primary", () => {
    for (const box of ["iloc", "pitm", "iinf", "iprp"]) expect(recordedSize({ ...avif(1200, 800), without: [box] }), box).toBeNull();
    expect(recordedSize({ ...avif(1200, 800), handler: "vide" })).toBeNull();
    // libheif 1.19 takes a file with no handler, which later versions refuse.
    expect(recordedSize({ ...avif(1200, 800), handler: null })).toEqual({ width: 1200, height: 800 });
    const whole = heifFile(avif(1200, 800));
    expect(recordedSize(whole.subarray(0, whole.length - 30))).toBeNull();
  });
});
