import type { SavedItem } from "@ember/protocol";
import { bodyFromPlainText } from "@ember/richtext/dom";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSaves } from "./use-saves";

/** The saves the GET answers with, next answer first, or nothing, which answers an empty list. */
const answers: Array<() => Promise<Response>> = [];

/** How many times the list was asked for. */
const asks = () => vi.mocked(fetch).mock.calls.filter(([input, init]) => String(input) === "/api/saves" && (init?.method ?? "GET") === "GET").length;

beforeEach(() => {
  answers.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/saves" && (init?.method ?? "GET") === "GET") return (answers.shift() ?? (() => Response.json({ saves: [] })))();
      if (path === "/api/saves" && init?.method === "POST") return Response.json({ save: { id: "s-new", roomId: "general", messageId: "m-new", createdAt: 1 } }, { status: 201 });
      if (path.startsWith("/api/saves/") && init?.method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`No answer for ${init?.method ?? "GET"} ${path}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The save `id` of the message `messageId`, as `GET /api/saves` answers it. */
const saved = (id: string, messageId: string): SavedItem => ({
  id,
  roomId: "general",
  messageId,
  createdAt: 0,
  message: { id: messageId, clientMessageId: messageId, roomId: "general", creator: { id: "u2", name: "Grace" }, body: bodyFromPlainText("Hello"), plainText: "Hello", mentions: [], createdAt: "2026-10-15T12:00:00.000Z", updatedAt: "2026-10-15T12:00:00.000Z", editedAt: null, boosts: [] },
});

describe("The saves hook", () => {
  it("asks for the list when it loads, and again once a save is made", async () => {
    answers.push(async () => Response.json({ saves: [saved("s1", "m1")] }));
    const onFailed = vi.fn();
    const { result } = renderHook(() => useSaves(onFailed));
    await waitFor(() => expect(result.current.saves).toEqual([saved("s1", "m1")]));
    await act(async () => {
      await result.current.save("general", "m-new");
    });
    await waitFor(() => expect(asks()).toBe(2));
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("takes a save out at once, and doesn't ask again while no answer is on its way", async () => {
    answers.push(async () => Response.json({ saves: [saved("s1", "m1"), saved("s2", "m2")] }));
    const onFailed = vi.fn();
    const { result } = renderHook(() => useSaves(onFailed));
    await waitFor(() => expect(result.current.saves).toHaveLength(2));
    await act(async () => {
      await result.current.forget("s1");
    });
    expect(result.current.saves).toEqual([saved("s2", "m2")]);
    expect(asks()).toBe(1);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("leaves an answer that set out before a remove, and asks for the list afresh, so what was taken out stays out", async () => {
    // The list's first answer waits, as one on a slow connection does, while the save is removed.
    let release!: () => void;
    answers.push(
      () =>
        new Promise<Response>((done) => {
          release = () => done(Response.json({ saves: [saved("s1", "m1"), saved("s2", "m2")] }));
        }),
    );
    const onFailed = vi.fn();
    const { result } = renderHook(() => useSaves(onFailed));
    await act(async () => {
      await result.current.forget("s1");
    });
    // The list that set out before the remove arrives, holding what it took out: it's left, and a fresh one asked for.
    answers.push(async () => Response.json({ saves: [saved("s2", "m2")] }));
    await act(() => {
      release();
      return Promise.resolve();
    });
    await waitFor(() => expect(result.current.saves).toEqual([saved("s2", "m2")]));
    expect(asks()).toBe(2);
  });

  it("asks again when the pane's load is called, which a failed ask never brought", async () => {
    answers.push(async () => Promise.reject(new TypeError("Failed to fetch")));
    const onFailed = vi.fn();
    const { result } = renderHook(() => useSaves(onFailed));
    await waitFor(() => expect(onFailed).toHaveBeenCalledOnce());
    expect(result.current.saves).toBeNull();
    answers.push(async () => Response.json({ saves: [saved("s1", "m1")] }));
    act(() => result.current.load());
    await waitFor(() => expect(result.current.saves).toEqual([saved("s1", "m1")]));
    expect(asks()).toBe(2);
  });
});
