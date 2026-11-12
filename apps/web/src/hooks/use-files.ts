import { useEffect, useSyncExternalStore } from "react";
import type { FileMarks, LibraryFile } from "@ember/protocol/library";
import { fetchFiles, markFile } from "@/lib/library";

// The workspace's files, as the Files page and its navigation both show them: loaded when either mounts,
// and kept as starring or opening one changes them, so the Starred list beside the page stays in step.

interface FilesState {
  files: LibraryFile[] | null;
  /** Whether the latest load failed. */
  failed: boolean;
}

let state: FilesState = { files: null, failed: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function set(next: FilesState): void {
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Loads the files afresh, telling `onFailed` why it couldn't. */
export function reloadFiles(onFailed?: (error: unknown) => void): Promise<void> {
  loading ??= fetchFiles().then(
    ({ files }) => {
      loading = null;
      set({ files, failed: false });
    },
    (error: unknown) => {
      loading = null;
      set({ ...state, failed: true });
      onFailed?.(error);
    },
  );
  return loading;
}

/** The workspace's files, loading them afresh whenever a page that shows them mounts. */
export function useFiles(onFailed?: (error: unknown) => void): FilesState {
  useEffect(() => void reloadFiles(onFailed), [onFailed]);
  return useSyncExternalStore(subscribe, () => state);
}

function withMarks(fileId: string, marks: Partial<FileMarks>): void {
  if (state.files) set({ ...state, files: state.files.map((file) => (file.id === fileId ? { ...file, ...marks } : file)) });
}

/** Stars `file`, or not, at once, and puts it back if that fails. */
export async function starFile(file: Pick<LibraryFile, "id" | "roomId" | "starred">, starred: boolean, onFailed: (error: unknown) => void): Promise<void> {
  withMarks(file.id, { starred });
  try {
    withMarks(file.id, await markFile({ fileId: file.id, roomId: file.roomId, starred }));
  } catch (error) {
    withMarks(file.id, { starred: file.starred });
    onFailed(error);
  }
}

/** Records that `file` was opened, for Recently viewed, quietly: a failure only leaves it unrecorded. */
export function fileOpened(file: Pick<LibraryFile, "id" | "roomId">): void {
  withMarks(file.id, { viewedAt: new Date().toISOString() });
  markFile({ fileId: file.id, roomId: file.roomId, viewed: true }).then((marks) => withMarks(file.id, marks), () => {});
}
