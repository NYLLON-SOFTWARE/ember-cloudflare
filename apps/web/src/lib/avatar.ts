// ember-rust's generated avatars: initials on one of 18 colors picked by CRC32 of the user id
// (crates/views/src/helpers/users.rs, from Campfire's Users::AvatarsHelper).

const AVATAR_COLORS = [
  "#AF2E1B", "#CC6324", "#3B4B59", "#BFA07A", "#ED8008", "#ED3F1C", "#BF1B1B", "#736B1E", "#D07B53",
  "#736356", "#AD1D1D", "#BF7C2A", "#C09C6F", "#698F9C", "#7C956B", "#5D618F", "#3B3633", "#67695E",
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function avatarColor(userId: string): string {
  return AVATAR_COLORS[crc32(userId) % AVATAR_COLORS.length]!;
}

/** Campfire's `name.scan(/\b\w/).join`, capped at three letters. */
export function initials(name: string): string {
  return (name.match(/\b\w/g) ?? ["?"]).join("").slice(0, 3);
}
