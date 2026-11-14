import type { LibraryFile } from "@ember/protocol/library";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchFiles } from "@/lib/library";
import { useFiles } from "./use-files";

vi.mock("@/lib/library", () => ({ fetchFiles: vi.fn(), markFile: vi.fn() }));

const fileOf = (name: string) => ({ id: name, name }) as unknown as LibraryFile;

/** A load of the files, which answers when told to. */
function loadWaiting() {
  let answer: (files: LibraryFile[]) => void = () => {};
  vi.mocked(fetchFiles).mockReturnValueOnce(new Promise((resolve) => (answer = (files) => resolve({ files } as Awaited<ReturnType<typeof fetchFiles>>))));
  return (files: LibraryFile[]) => act(() => answer(files));
}

describe("useFiles", () => {
  it("shows only the files of whoever is signed in here now, dropping a load still on its way for someone before", async () => {
    const answerAnn = loadWaiting();
    const ann = renderHook(() => useFiles("ann"));
    await answerAnn([fileOf("ann-plan.pdf")]);
    await waitFor(() => expect(ann.result.current.files).toEqual([fileOf("ann-plan.pdf")]));
    ann.unmount();

    // Another tab signs in as Bob while the page is loading Ann's files again.
    const answerAnnAgain = loadWaiting();
    const annAgain = renderHook(() => useFiles("ann"));
    annAgain.unmount();
    const answerBob = loadWaiting();
    const bob = renderHook(() => useFiles("bob"));
    expect(bob.result.current.files).toBeNull();
    await answerAnnAgain([fileOf("ann-secret.pdf")]);
    expect(bob.result.current.files).toBeNull();
    await answerBob([fileOf("bob-notes.txt")]);
    await waitFor(() => expect(bob.result.current.files).toEqual([fileOf("bob-notes.txt")]));
  });
});
