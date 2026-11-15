import type { ShareWidening, StoredFile } from "@ember/protocol";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilesPicker } from "./files-picker";

afterEach(() => vi.unstubAllGlobals());

/** A file named `name`, shared as message `id`. */
const sharedAs = (id: string, name: string) => {
  const file: StoredFile = { id: `f-${id}`, name, contentType: "text/plain", byteSize: 3, url: `/files/${id}`, downloadUrl: `/files/${id}?download` };
  return { message: { id, roomId: "r9", creator: { id: "u2", name: "Grace" }, attachment: file, createdAt: "2026-11-01T10:00:00Z" }, words: [] };
};

/** The Worker as Files in Ember asks it: a first page of files, with a cursor to a second, which ends the list. */
function twoPages() {
  const fetch = vi.fn(async (path: string) => {
    const cursor = new URL(path, location.href).searchParams.get("cursor");
    return Response.json({
      search: { q: "", hasFile: true },
      matches: cursor === null ? [sharedAs("m2", "newer.txt")] : [sharedAs("m1", "older.txt")],
      next: cursor === null ? 50 : null,
      rooms: [{ id: "r9", kind: "open", name: "design", icon: null }],
      recent: [],
    });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** jsdom has no IntersectionObserver: this one tells each element observed it's come into view when `scrolledToEnd` says so. */
function intersections() {
  const observers = new Set<{ callback: IntersectionObserverCallback; elements: Element[] }>();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private observer: { callback: IntersectionObserverCallback; elements: Element[] };
      constructor(callback: IntersectionObserverCallback) {
        this.observer = { callback, elements: [] };
        observers.add(this.observer);
      }
      observe(element: Element) {
        this.observer.elements.push(element);
      }
      disconnect() {
        observers.delete(this.observer);
      }
    },
  );
  const scrolledToEnd = () =>
    act(() =>
      observers.forEach(({ callback, elements }) =>
        callback(elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), {} as IntersectionObserver),
      ),
    );
  return { scrolledToEnd, observing: () => observers.size };
}

describe("Files in Ember", () => {
  it("loads older files as the list is scrolled to its end, until the last page", async () => {
    const fetch = twoPages();
    const { scrolledToEnd, observing } = intersections();
    render(<FilesPicker meId="u1" roomId="r1" room={{ label: "#general", direct: false }} onPick={() => {}} onClose={() => {}} onReturnFocus={() => {}} />);
    const list = await screen.findByRole("list", { name: "Files" });
    expect(within(list).getAllByRole("button").map((button) => button.querySelector(".font-semibold")?.textContent)).toEqual(["newer.txt"]);

    await scrolledToEnd();
    await within(list).findByText("older.txt");
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new URL(fetch.mock.calls[1]![0], location.href).searchParams.get("cursor")).toBe("50");
    // The last page has no end to watch for.
    expect(observing()).toBe(0);
  });

  it("attaches nothing once the warning's Cancel is pressed, though Attach's check answers after it", async () => {
    const widening: ShareWidening = { widens: true, newViewers: 2, names: ["Lin", "Sam"] };
    let answerAttach: (response: Response) => void = () => {};
    let checks = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (path: string) => {
        if (path === "/api/share-check") return ++checks === 1 ? Response.json(widening) : new Promise<Response>((resolve) => (answerAttach = resolve));
        return Response.json({ search: { q: "", hasFile: true }, matches: [sharedAs("m1", "plan.txt")], next: null, rooms: [{ id: "r9", kind: "open", name: "design", icon: null }], recent: [] });
      }),
    );
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<FilesPicker meId="u1" roomId="r1" room={{ label: "#general", direct: false }} onPick={onPick} onClose={() => {}} onReturnFocus={() => {}} />);
    await user.click(await screen.findByRole("button", { name: /plan\.txt/ }));
    const warning = await screen.findByRole("alertdialog");
    await user.click(within(warning).getByRole("button", { name: "Attach" }));
    await user.click(within(warning).getByRole("button", { name: "Cancel" }));
    await act(async () => answerAttach(Response.json(widening)));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
