import { REACTIONS } from "@ember/protocol";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import rows from "./emoji-data.json";
import { closedCode, FAVORED, indexOf, loadEmoji, MAX_MATCHES, recentEmoji, rememberEmoji, searchEmoji, typedCode } from "./emoji";

const index = indexOf(rows as Parameters<typeof indexOf>[0]);
const found = (query: string, recent?: string[]) => searchEmoji(index, query, recent).map(({ emoji, code }) => `${emoji}${code}`);

describe("A :code being typed", () => {
  it("is what follows a colon at the start, or after a space or an opening bracket, once it's two characters", () => {
    expect(typedCode(":ta")).toBe("ta");
    expect(typedCode("Ship it :tada")).toBe("tada");
    expect(typedCode("(:+1")).toBe("+1");
    expect(typedCode("line\n:-1")).toBe("-1");
    expect(typedCode(":t")).toBeNull();
  });

  it("isn't a time, a word's colon, a smiley or a code that's closed", () => {
    for (const text of ["12:30", "Note:ab", ":)", ":-)", ":D", ":tada:", ":ta da"]) expect(typedCode(text)).toBeNull();
  });
});

describe("A :code's closing colon", () => {
  it("finds the code's emoji, any case, and the text it replaces", () => {
    expect(closedCode(index, "Ship it :tada:")).toEqual({ typed: ":tada:", emoji: "🎉", base: "🎉" });
    expect(closedCode(index, ":THUMBSUP:")).toEqual({ typed: ":THUMBSUP:", emoji: "👍", base: "👍" });
    expect(closedCode(index, ":o:")).toEqual({ typed: ":o:", emoji: "⭕", base: "⭕" });
  });

  it("finds nothing for a code no emoji has, or a colon inside a word", () => {
    expect(closedCode(index, ":not_an_emoji:")).toBeNull();
    expect(closedCode(index, "re:fire:")).toBeNull();
    expect(closedCode(index, "::")).toBeNull();
  });
});

describe("Searching emoji", () => {
  it("knows Slack's codes, aliases too", () => {
    expect(found("+1")[0]).toBe("👍+1");
    expect(found("thumbsup")[0]).toBe("👍thumbsup");
    expect(found("tada")[0]).toBe("🎉tada");
    expect(found("joy")[0]).toBe("😂joy");
  });

  it("lists codes that start with what's typed, then words of codes, then names and other words, then codes that hold it", () => {
    expect(found("fire").slice(0, 4)).toEqual(["🔥fire", "🧑‍🚒firefighter", "🚒fire_engine", "🎆fireworks"]);
    expect(found("fire")).toContain("❤️‍🔥heart_on_fire");
    // "eyes" is a word of :heart_eyes:, :hugging_face: is found by its other words.
    expect(found("eyes")).toContain("😍heart_eyes");
    expect(found("hug")).toContain("🤗hugging_face");
    expect(found("party")).toContain("🎉tada");
  });

  it("lists an emoji whose code it is first, then those used lately, latest first, then Ember's reactions", () => {
    expect(found("fi", ["🎆", "🧨"]).slice(0, 3)).toEqual(["🎆fireworks", "🧨firecracker", "🔥fire"]);
    expect(found("fire", ["🎆"]).slice(0, 2)).toEqual(["🔥fire", "🎆fireworks"]);
    expect(found("cl", ["👏"]).slice(0, 2)).toEqual(["🆑cl", "👏clap"]);
    expect(found("th")[0]).toBe("👍thumbsup");
    expect(found("hea")[0]).toBe("❤️heart");
  });

  it("favors Ember's reactions", () => {
    expect(FAVORED).toEqual(REACTIONS.map(([emoji]) => emoji));
  });

  it("favors none for a code that only holds what's typed", () => {
    expect(found("cl")).not.toContain("💪muscle");
    expect(found("uscle", ["💪"])[0]).toBe("💪muscle");
  });

  it(`lists at most ${MAX_MATCHES}, and none for what finds nothing`, () => {
    expect(found("s")).toHaveLength(MAX_MATCHES);
    expect(found("zzzzz")).toEqual([]);
  });

  it("leaves out skin tones and emoji too new for most devices to draw", () => {
    const emoji = new Set(rows.map(([emoji]) => emoji));
    expect(emoji.has("👍🏽")).toBe(false);
    expect(emoji.has("🫎")).toBe(true); // Emoji 15.0
    expect(emoji.has("🐦‍🔥")).toBe(false); // Emoji 15.1
  });

  it("loads the emoji once", async () => {
    expect(await loadEmoji()).toBe(await loadEmoji());
  });

  it("tries loading the emoji again when they couldn't be, as when the network's down", async () => {
    vi.resetModules();
    let offline = true;
    vi.doMock("./emoji-data.json", () => {
      if (offline) throw new TypeError("Failed to fetch dynamically imported module");
      return { default: rows };
    });
    onTestFinished(() => vi.doUnmock("./emoji-data.json"));
    const { loadEmoji: load, loadedEmoji: loaded } = await import("./emoji");
    await expect(load()).rejects.toThrow();
    expect(loaded()).toBeNull();

    offline = false;
    expect((await load()).byCode.get("tada")?.emoji).toBe("🎉");
  });
});

describe("Emoji in your skin tone", () => {
  it("lists people and hands in your tone, and the rest as they are", () => {
    expect(searchEmoji(index, "wave", [], 4)[0]).toMatchObject({ emoji: "👋🏾", base: "👋", code: "wave" });
    expect(searchEmoji(index, "tada", [], 4)[0]).toMatchObject({ emoji: "🎉", base: "🎉" });
  });

  it("puts a closed code's emoji in your tone", () => {
    expect(closedCode(index, ":+1:", 2)).toEqual({ typed: ":+1:", emoji: "👍🏼", base: "👍" });
    expect(closedCode(index, ":fire:", 2)).toEqual({ typed: ":fire:", emoji: "🔥", base: "🔥" });
  });

  it("puts an emoji in the tone of Slack's :skin-tone-2: to :skin-tone-6: after it, whatever tone you chose", () => {
    expect(closedCode(index, "Hi 👋:skin-tone-4:", 1)).toEqual({ typed: "👋:skin-tone-4:", emoji: "👋🏽", base: "👋" });
    expect(closedCode(index, "👍🏻:skin-tone-6:")).toEqual({ typed: "👍🏻:skin-tone-6:", emoji: "👍🏿", base: "👍" });
    expect(closedCode(index, "✌️:skin-tone-2:")).toEqual({ typed: "✌️:skin-tone-2:", emoji: "✌🏻", base: "✌️" });
  });

  it("leaves a skin tone's code alone after an emoji without tones, or nothing", () => {
    expect(closedCode(index, "🎉:skin-tone-3:")).toBeNull();
    expect(closedCode(index, ":skin-tone-3:")).toBeNull();
    expect(closedCode(index, "👋:skin-tone-1:")).toBeNull();
  });
});

describe("Emoji used lately", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("are remembered latest first, each once", () => {
    rememberEmoji("🎉");
    rememberEmoji("🔥");
    rememberEmoji("🎉");
    expect(recentEmoji()).toEqual(["🎉", "🔥"]);
  });

  it("are none where storage is refused", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("refused");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("refused");
    });
    rememberEmoji("🎉");
    expect(recentEmoji()).toEqual([]);
  });
});
