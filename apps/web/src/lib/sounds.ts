import type { Sound, SoundImage } from "@ember/richtext/dom";

// Campfire's clips and pictures, which the build fetches and serves beside the app (plugins/campfire-sounds.ts).

/** Where a sound's clip is served. */
export const soundUrl = ({ name }: Sound) => `/sounds/${name}.mp3`;

/** Where a sound's picture is served. */
export const soundImageUrl = ({ file }: SoundImage) => `/sounds/images/${file}`;

/**
 * Plays a sound once, as Campfire's sound_controller.js does. A browser can refuse to, as before the page
 * has been used, which goes unremarked, where Campfire's leaves the refusal in the console.
 */
export function playSound(sound: Sound) {
  new Audio(soundUrl(sound)).play().catch(() => {});
}
