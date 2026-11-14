import { useEffect, useSyncExternalStore } from "react";
import { fileMarkOf, type FileMarks, type LibraryFile } from "@ember/protocol/library";
import { fetchFiles, markFile } from "@/lib/library";

// The workspace's files, as the Files page and its navigation both show them: loaded when either mounts,
// and kept as starring or opening one changes them, so the Starred list beside the page stays in step.
// They're whoever's signed in's: another tab signing this browser in as someone else starts them afresh,
// and drops a load still on its way for the person before.

interface FilesState {
  files: LibraryFile[] | null;
  /** Whether the latest load failed. */
  failed: boolean;
}

const NO_FILES: FilesState = { files: null, failed: false };

/** Whose files `state` holds. */
let owner: string | null = null;
let state = NO_FILES;
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** Starts afresh for `userId`, unless the files are theirs already. */
function filesOf(userId: string): void {
  if (owner === userId) return;
  owner = userId;
  state = NO_FILES;
  loading = null;
}

function set(next: FilesState): void {
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Loads `userId`'s files afresh, telling `onFailed` why it couldn't. */
export function reloadFiles(userId: string, onFailed?: (error: unknown) => void): Promise<void> {
  filesOf(userId);
  const load: Promise<void> = (loading ??= fetchFiles().then(
    ({ files }) => {
      if (loading !== load) return;
      loading = null;
      set({ files, failed: false });
    },
    (error: unknown) => {
      if (loading !== load) return;
      loading = null;
      set({ ...state, failed: true });
      onFailed?.(error);
    },
  ));
  return load;
}

/** The files of `userId`, who's signed in, loading them afresh whenever a page that shows them mounts. */
export function useFiles(userId: string, onFailed?: (error: unknown) => void): FilesState {
  useEffect(() => void reloadFiles(userId, onFailed), [userId, onFailed]);
  return useSyncExternalStore(subscribe, () => (owner === userId ? state : NO_FILES));
}

function withMarks(fileId: string, marks: Partial<FileMarks>): void {
  if (state.files) set({ ...state, files: state.files.map((file) => (file.id === fileId ? { ...file, ...marks } : file)) });
}

/** Stars `file`, or not, at once, and puts it back if that fails. */
export async function starFile(file: Pick<LibraryFile, "id" | "kind" | "roomId" | "messageId" | "starred">, starred: boolean, onFailed: (error: unknown) => void): Promise<void> {
  withMarks(file.id, { starred });
  try {
    withMarks(file.id, await markFile({ ...fileMarkOf(file), starred }));
  } catch (error) {
    withMarks(file.id, { starred: file.starred });
    onFailed(error);
  }
}

/** Records that `file` was opened, for Recently viewed, quietly: a failure only leaves it unrecorded. */
export function fileOpened(file: Pick<LibraryFile, "id" | "kind" | "roomId" | "messageId">): void {
  withMarks(file.id, { viewedAt: new Date().toISOString() });
  markFile({ ...fileMarkOf(file), viewed: true }).then((marks) => withMarks(file.id, marks), () => {});
}
