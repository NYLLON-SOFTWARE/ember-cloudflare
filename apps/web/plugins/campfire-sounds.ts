import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SOUNDS } from "@ember/richtext/sounds";
import type { Plugin } from "vite";
import manifest from "./campfire-sounds.json" with { type: "json" };

/** A file the app serves under /sounds/, as Campfire's repository keeps it. */
export interface CampfireFile {
  /** Where it is in once-campfire. */
  from: string;
  /** Where it's served, under /sounds/. */
  to: string;
  sha256: string;
}

/** Fetches a URL, as `fetch` does. */
export type Download = (url: string) => Promise<Response>;

/** Where Campfire's files come from: once-campfire at the commit ember-rust's reference/ submodule pins. */
const SOURCE = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/`;

/** Where downloaded files are kept between builds. */
const CACHE = path.resolve(import.meta.dirname, "../node_modules/.cache/campfire-sounds");

const CONTENT_TYPES: Record<string, string> = { ".mp3": "audio/mpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8" };

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Each sound's clip and picture, as `/sounds/<name>.mp3` and `/sounds/images/<file>`, and Campfire's license beside them. */
export function campfireFiles(): CampfireFile[] {
  const file = (from: string, to: string): CampfireFile => {
    const checksum = (manifest.sha256 as Record<string, string>)[from];
    if (checksum === undefined) throw new Error(`campfire-sounds.json has no checksum for ${from}`);
    return { from, to, sha256: checksum };
  };
  return [
    file("MIT-LICENSE", "LICENSE.txt"),
    ...SOUNDS.map(({ name }) => file(`app/assets/sounds/${name}.mp3`, `${name}.mp3`)),
    ...SOUNDS.flatMap((sound) => ("image" in sound ? [file(`app/assets/images/sounds/${sound.image.file}`, `images/${sound.image.file}`)] : [])),
  ];
}

/**
 * Downloads to `cache` each of `files` that isn't there already with its checksum, and refuses any that
 * comes with another, so a build serves exactly the files ember-rust's does.
 */
export async function fetchFiles(files: CampfireFile[], cache: string, download: Download = fetch) {
  await Promise.all(
    files.map(async ({ from, sha256: expected }) => {
      const file = path.join(cache, from);
      const kept = await readFile(file).catch(() => null);
      if (kept && sha256(kept) === expected) return;
      const response = await download(SOURCE + from);
      if (!response.ok) throw new Error(`Couldn't download ${from} from Campfire (${response.status} ${response.statusText})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (sha256(bytes) !== expected) throw new Error(`${from} from Campfire isn't the file campfire-sounds.json names`);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }),
  );
}

/**
 * Serves Campfire's `/play` sounds and their pictures at /sounds/, downloading them from once-campfire
 * rather than keeping them in Ember's repository, as ember-rust serves them from its reference/
 * submodule: most are samples, which 37signals publishes under Campfire's MIT license. A build
 * downloads them first, keeps them in node_modules/.cache, and writes them beside the bundle. The dev
 * server downloads them when one is first asked for.
 */
export function campfireSounds(): Plugin {
  const files = campfireFiles();
  let building = false;
  return {
    name: "ember-campfire-sounds",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (building) await fetchFiles(files, CACHE);
    },
    configureServer(server) {
      let fetched: Promise<void> | undefined;
      server.middlewares.use((request, response, next) => {
        const served = /^\/sounds\/([^?#]+)/.exec(request.url ?? "")?.[1];
        const file = files.find(({ to }) => to === served);
        if (!file) return next();
        // One that fails is tried again on the next request.
        (fetched ??= fetchFiles(files, CACHE).catch((error) => ((fetched = undefined), Promise.reject(error))))
          .then(() => readFile(path.join(CACHE, file.from)))
          .then((bytes) => {
            response.setHeader("Content-Type", CONTENT_TYPES[path.extname(file.to)]!);
            response.end(bytes);
          }, next);
      });
    },
    async writeBundle({ dir }) {
      await Promise.all(
        files.map(async ({ from, to }) => {
          const file = path.join(dir!, "sounds", to);
          await mkdir(path.dirname(file), { recursive: true });
          await copyFile(path.join(CACHE, from), file);
        }),
      );
    },
  };
}
