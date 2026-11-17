import { describe, expect, it } from "vitest";
import { withDuration } from "./webm-duration";

const EBML_HEADER = [0x1a, 0x45, 0xdf, 0xa3, 0x84, 0x42, 0x86, 0x81, 0x01];
const SEGMENT_ID = [0x18, 0x53, 0x80, 0x67];
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const INFO_ID = [0x15, 0x49, 0xa9, 0x66];
/** A timestamp scale of a millisecond, and the muxer's name, as MediaRecorder's Info has them. */
const INFO_DATA = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40, 0x4d, 0x80, 0x84, ...new TextEncoder().encode("test")];
const TRACKS = [0x16, 0x54, 0xae, 0x6b, 0x80];
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, ...UNKNOWN_SIZE, 0xe7, 0x81, 0x00];

const webm = (segmentSize = UNKNOWN_SIZE, beforeInfo: number[] = [], infoData = INFO_DATA) =>
  Uint8Array.from([...EBML_HEADER, ...SEGMENT_ID, ...segmentSize, ...beforeInfo, ...INFO_ID, 0x80 | infoData.length, ...infoData, ...TRACKS, ...CLUSTER]);

/** The file as it's put back together: the new start, then the rest of the old. */
const patched = (file: Uint8Array, milliseconds: number) => {
  const result = withDuration(file, milliseconds)!;
  return Uint8Array.from([...result.head, ...file.subarray(result.replaced)]);
};

const indexOf = (bytes: Uint8Array, sought: number[]) => bytes.findIndex((_, at) => sought.every((byte, i) => bytes[at + i] === byte));

describe("withDuration", () => {
  it("writes how long a WebM is into its Info, in the Info's units, after what it had, and leaves the rest as it was", () => {
    const file = patched(webm(), 1500);
    const info = indexOf(file, INFO_ID);
    // The Info's size grows by the duration's 11 bytes, written in 8.
    expect([...file.subarray(info + 4, info + 12)]).toEqual([0x01, 0, 0, 0, 0, 0, 0, INFO_DATA.length + 11]);
    expect([...file.subarray(info + 12, info + 12 + INFO_DATA.length)]).toEqual(INFO_DATA);
    const duration = info + 12 + INFO_DATA.length;
    expect([...file.subarray(duration, duration + 3)]).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(file.buffer, duration + 3, 8).getFloat64(0)).toBe(1500);
    expect([...file.subarray(duration + 11)]).toEqual([...TRACKS, ...CLUSTER]);
    expect([...file.subarray(0, info)]).toEqual([...EBML_HEADER, ...SEGMENT_ID, ...UNKNOWN_SIZE]);
  });

  it("counts the duration in the Info's own units", () => {
    // A timestamp scale of a microsecond, which counts 1.5 seconds as 1,500,000.
    const infoData = [0x2a, 0xd7, 0xb1, 0x82, 0x03, 0xe8];
    const file = patched(webm(UNKNOWN_SIZE, [], infoData), 1500);
    const duration = indexOf(file, [0x44, 0x89, 0x88]);
    expect(new DataView(file.buffer, duration + 3, 8).getFloat64(0)).toBe(1_500_000);
  });

  it("grows a segment that says how big it is by what the Info grew", () => {
    const rest = INFO_ID.length + 1 + INFO_DATA.length + TRACKS.length + CLUSTER.length;
    const file = patched(webm([0x01, 0, 0, 0, 0, 0, 0, rest]), 1000);
    const segment = indexOf(file, SEGMENT_ID);
    // The Info's size went from 1 byte to 8, and it gained the duration's 11.
    expect([...file.subarray(segment + 4, segment + 12)]).toEqual([0x01, 0, 0, 0, 0, 0, 0, rest + 7 + 11]);
    expect(file.length - (segment + 12)).toBe(rest + 7 + 11);
  });

  it("leaves alone a file that isn't a WebM, one that says how long it is, one with a SeekHead, and a start too short to hold its Info", () => {
    expect(withDuration(new TextEncoder().encode("\0\0\0\x20ftypisom"), 1000)).toBeNull();
    expect(withDuration(webm(UNKNOWN_SIZE, [], [...INFO_DATA, 0x44, 0x89, 0x84, 0x45, 0x9c, 0x40, 0x00]), 1000)).toBeNull();
    expect(withDuration(webm(UNKNOWN_SIZE, [0x11, 0x4d, 0x9b, 0x74, 0x80]), 1000)).toBeNull();
    expect(withDuration(webm().subarray(0, EBML_HEADER.length + 16), 1000)).toBeNull();
  });
});
