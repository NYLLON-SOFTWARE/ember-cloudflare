import type { CustomEmoji } from "@ember/protocol";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCustomEmojiList } from "./use-custom-emoji-list";

const emoji = (name: string): CustomEmoji => ({ name, key: `key-${name}`, creatorId: "u1", createdAt: "2026-11-14T12:00:00.000Z" });
const shipit = emoji("shipit");
const parrot = emoji("party_parrot");

/** Answers each load of the list in turn with what `answers` holds, the last for good. */
function serve(...answers: Array<() => Response | Promise<Response>>) {
  let asked = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => answers[Math.min(asked++, answers.length - 1)]!());
}

const listing = (...listed: CustomEmoji[]) => () => Response.json({ emoji: listed });

afterEach(() => vi.restoreAllMocks());

describe("The workspace's custom emoji", () => {
  it("are none until they load, then each by its name", async () => {
    const fetched = serve(listing(parrot, shipit));
    const { result } = renderHook(() => useCustomEmojiList());
    expect(result.current.emoji.size).toBe(0);

    await act(() => result.current.reload());
    expect(fetched).toHaveBeenCalledWith("/api/emoji", expect.anything());
    expect([...result.current.emoji.keys()]).toEqual(["party_parrot", "shipit"]);
    expect(result.current.emoji.get("shipit")).toEqual(shipit);
  });

  it("follow what the workspace socket says is added and removed", async () => {
    serve(listing(shipit));
    const { result } = renderHook(() => useCustomEmojiList());
    await act(() => result.current.reload());

    act(() => result.current.add(parrot));
    expect([...result.current.emoji.keys()]).toEqual(["shipit", "party_parrot"]);
    act(() => result.current.remove("shipit"));
    expect([...result.current.emoji.keys()]).toEqual(["party_parrot"]);
    // Removing one that's gone, and adding one that's listed, change nothing else.
    act(() => result.current.remove("shipit"));
    act(() => result.current.add(parrot));
    expect([...result.current.emoji.keys()]).toEqual(["party_parrot"]);
  });

  it("keep what changed while a load was on its way, which may have listed them before it did", async () => {
    let answer: (response: Response) => void = () => {};
    serve(() => new Promise<Response>((resolve) => (answer = resolve)));
    const { result } = renderHook(() => useCustomEmojiList());
    let loading: Promise<void> = Promise.resolve();
    act(() => void (loading = result.current.reload()));
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    act(() => result.current.add(parrot));
    act(() => result.current.remove("shipit"));
    // The list was read before either.
    await act(async () => {
      answer(Response.json({ emoji: [shipit] }));
      await loading;
    });
    expect([...result.current.emoji.keys()]).toEqual(["party_parrot"]);
  });

  it("don't bring back an emoji removed since it was added, when adding it here is answered late", async () => {
    serve(listing());
    const { result } = renderHook(() => useCustomEmojiList());
    await act(() => result.current.reload());

    // The socket says it was added, then that someone removed it, before the page hears its own answer.
    act(() => result.current.add(shipit));
    act(() => result.current.remove("shipit"));
    act(() => result.current.add(shipit));
    expect(result.current.emoji.size).toBe(0);

    // Another of the same name, added since, is another emoji.
    act(() => result.current.add({ ...shipit, key: "key-shipit-again" }));
    expect(result.current.emoji.get("shipit")?.key).toBe("key-shipit-again");
  });

  it("stay as they were when a load fails", async () => {
    serve(listing(shipit), () => Response.json({ error: "Not signed in" }, { status: 401 }));
    const { result } = renderHook(() => useCustomEmojiList());
    await act(() => result.current.reload());
    await act(() => result.current.reload().catch(() => {}));
    expect([...result.current.emoji.keys()]).toEqual(["shipit"]);
  });
});
