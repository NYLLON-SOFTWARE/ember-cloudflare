import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { feature } from "@ember/parity";
import { SOUNDS } from "@ember/richtext/sounds";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campfireFiles, fetchFiles, type CampfireFile } from "./campfire-sounds.ts";
import manifest from "./campfire-sounds.json" with { type: "json" };

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const file = (from: string, text: string): CampfireFile => ({ from, to: from, sha256: sha256(text) });
const SOURCE = `https://raw.githubusercontent.com/basecamp/once-campfire/${manifest.commit}/`;

let cache: string;
beforeEach(async () => {
  cache = await mkdtemp(path.join(tmpdir(), "campfire-sounds-"));
});
afterEach(async () => {
  await rm(cache, { recursive: true, force: true });
});

describe(feature("messages.sounds"), () => {
  it("serves every sound's clip, and the pictures some have, with Campfire's license, each with its checksum", () => {
    const files = campfireFiles();
    expect(files.map(({ to }) => to)).toEqual([
      "LICENSE.txt",
      ...SOUNDS.map(({ name }) => `${name}.mp3`),
      ...SOUNDS.flatMap((sound) => ("image" in sound ? [`images/${sound.image.file}`] : [])),
    ]);
    // The manifest names no file the app doesn't serve.
    expect(Object.keys(manifest.sha256).sort()).toEqual(files.map(({ from }) => from).sort());
    expect(files.find(({ to }) => to === "deeper.mp3")).toEqual({ from: "app/assets/sounds/deeper.mp3", to: "deeper.mp3", sha256: manifest.sha256["app/assets/sounds/deeper.mp3"] });
    expect(files.find(({ to }) => to === "images/top.webp")?.from).toBe("app/assets/images/sounds/top.webp");
  });

  it("downloads from Campfire at its pinned commit what it doesn't have yet, and nothing it has", async () => {
    const download = vi.fn(async (url: string) => new Response(url.endsWith("bell.mp3") ? "ding" : "MIT"));
    const files = [file("app/assets/sounds/bell.mp3", "ding"), file("MIT-LICENSE", "MIT")];
    await fetchFiles(files, cache, download);
    expect(download.mock.calls.map(([url]) => url).sort()).toEqual([`${SOURCE}MIT-LICENSE`, `${SOURCE}app/assets/sounds/bell.mp3`]);
    expect(await readFile(path.join(cache, "app/assets/sounds/bell.mp3"), "utf8")).toBe("ding");

    download.mockClear();
    await fetchFiles(files, cache, download);
    expect(download).not.toHaveBeenCalled();
  });

  it("downloads again a file it has that isn't the one the manifest names", async () => {
    await writeFile(path.join(cache, "MIT-LICENSE"), "half a lic");
    const download = vi.fn(async () => new Response("MIT"));
    await fetchFiles([file("MIT-LICENSE", "MIT")], cache, download);
    expect(download).toHaveBeenCalledOnce();
    expect(await readFile(path.join(cache, "MIT-LICENSE"), "utf8")).toBe("MIT");
  });

  it("refuses a download that isn't the file the manifest names, or that fails, keeping neither", async () => {
    await expect(fetchFiles([file("MIT-LICENSE", "MIT")], cache, async () => new Response("GPL"))).rejects.toThrow("MIT-LICENSE from Campfire isn't the file campfire-sounds.json names");
    await expect(fetchFiles([file("MIT-LICENSE", "MIT")], cache, async () => new Response("Not Found", { status: 404, statusText: "Not Found" }))).rejects.toThrow(
      "Couldn't download MIT-LICENSE from Campfire (404 Not Found)",
    );
    await expect(readFile(path.join(cache, "MIT-LICENSE"))).rejects.toThrow("ENOENT");
  });
});
