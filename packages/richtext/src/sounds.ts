// `/play` sounds (ember-rust's crates/db/src/models/sound.rs, from reference/app/models/sound.rb).

/** A sound's picture: `sounds/<file>` at its size. */
export interface SoundImage {
  file: string;
  width: number;
  height: number;
}

/** A built-in sound, `<name>.mp3`, shown with its text or its picture. */
export type Sound = { name: string; text: string } | { name: string; image: SoundImage };

/** `Sound::BUILTIN`, in Campfire's order. */
export const SOUNDS: readonly Sound[] = [
  { name: "56k", image: { file: "56k.webp", width: 79, height: 33 } },
  { name: "bell", text: "🔔" },
  { name: "bezos", text: "😆💭" },
  { name: "bueller", text: "anyone?" },
  { name: "butts", text: "👐 🚬" },
  { name: "clowntown", image: { file: "clowntown.webp", width: 210, height: 150 } },
  { name: "cottoneyejoe", text: "🎶🙉🎶 " },
  { name: "crickets", text: "hears crickets chirping" },
  { name: "curb", image: { file: "curb.webp", width: 150, height: 101 } },
  { name: "dadgummit", text: "dad gummit!! 🎣" },
  { name: "dangerzone", image: { file: "dangerzone.webp", width: 157, height: 32 } },
  { name: "danielsan", text: "🎆 🏆 🎆" },
  { name: "deeper", image: { file: "top.webp", width: 188, height: 80 } },
  { name: "ballmer", text: "developers!" },
  { name: "donotwant", image: { file: "donotwant.webp", width: 150, height: 150 } },
  { name: "drama", image: { file: "drama.webp", width: 300, height: 16 } },
  { name: "flawless", text: "#flawless" },
  { name: "glados", text: "🤖💢" },
  { name: "gogogo", text: "Go, go, go!" },
  { name: "greatjob", image: { file: "greatjob.webp", width: 79, height: 16 } },
  { name: "greyjoy", text: "😖🎺" },
  { name: "guarantee", text: "guarantees it 👌" },
  { name: "heygirl", text: "✨💁✨" },
  { name: "honk", text: "HONK" },
  { name: "horn", text: "🐶 ✂️ 🐱" },
  { name: "horror", text: "💀 💀 💀 💀 💀 💀 💀" },
  { name: "inconceivable", text: "doesn't think it means what you think it means…" },
  { name: "letitgo", text: "❄️👩❄️⛄️❄️" },
  { name: "live", text: "is DOING IT LIVE" },
  { name: "loggins", image: { file: "loggins.webp", width: 200, height: 151 } },
  { name: "makeitso", text: "make it so 👉" },
  { name: "noooo", text: "👸💀😒" },
  { name: "nyan", image: { file: "nyan.webp", width: 36, height: 15 } },
  { name: "ohmy", text: "raises an eyebrow 😏" },
  { name: "ohyeah", text: "isn't playing by the rules" },
  { name: "pushit", image: { file: "pushit.webp", width: 104, height: 15 } },
  { name: "rimshot", text: "plays a rimshot" },
  { name: "rollout", text: "is rolling out 🚗" },
  { name: "rumble", image: { file: "rumble.webp", width: 220, height: 150 } },
  { name: "sax", text: "🌇🎷🎶" },
  { name: "secret", text: "found a secret area 🔑" },
  { name: "sexyback", text: "🔞" },
  { name: "story", text: "and now you know…" },
  { name: "tada", text: "plays a fanfare 🎏" },
  { name: "tmyk", text: "✨ ⭐️ The More You Know ✨ ⭐️" },
  { name: "totes", text: "😁👍" },
  { name: "trololo", text: "трололо" },
  { name: "trombone", text: "plays a sad trombone" },
  { name: "unix", text: "knows this 💻" },
  { name: "vuvuzela", text: "======<() ~ ♪ ~♫" },
  { name: "what", image: { file: "what.webp", width: 100, height: 131 } },
  { name: "whoomp", text: "👏‼️😎" },
  { name: "wups", text: "wups!" },
  { name: "yay", image: { file: "yay.webp", width: 103, height: 50 } },
  { name: "yeah", image: { file: "yeah.webp", width: 104, height: 15 } },
  { name: "yodel", text: "📣🗻🙉" },
];

/** `Sound.names`: sorted. */
export const SOUND_NAMES: readonly string[] = SOUNDS.map((sound) => sound.name).sort();

const PLAY_COMMAND = /^\/play ([A-Za-z0-9_]+)$/;

/**
 * `Message#sound`: `plain_text_body.match(/\A\/play (?<name>\w+)\z/)` naming a built-in sound,
 * so nothing may follow the name, not even a newline.
 */
export function soundIn(plainText: string): Sound | undefined {
  const name = PLAY_COMMAND.exec(plainText)?.[1];
  return name === undefined ? undefined : SOUNDS.find((sound) => sound.name === name);
}

const PENDING_PLAY_COMMAND = new RegExp(`^/play (${SOUND_NAMES.join("|")})`);

/**
 * The sound a message being sent shows "Playing <name>…" for (ember-rust's
 * crates/assets/overrides/models/client_message.js): the editor's trimmed text starting with
 * `/play <name>`, whatever follows it. The server may yet decide it isn't one.
 */
export function pendingSound(text: string): string | undefined {
  return PENDING_PLAY_COMMAND.exec(text.trim())?.[1];
}
