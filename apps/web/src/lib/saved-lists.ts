import { NOTE_FILES_PATH, type NoteFile, type SavedChange, type SavedItem, type SavedItems, type SavedList } from "@ember/protocol";
import { dataOf, json } from "./saved";

// The requests only the To-dos and Saved pages make, apart from lib/saved.ts, which every message's actions
// load with the app.

export async function fetchSavedList(list: SavedList): Promise<SavedItem[]> {
  return (await dataOf<SavedItems>(await fetch(`/api/saved?list=${list}`))).items;
}

export async function fetchSavedItem(id: string): Promise<SavedItem> {
  return dataOf<SavedItem>(await fetch(`/api/saved/${encodeURIComponent(id)}`));
}

export async function changeItem(id: string, change: SavedChange): Promise<SavedItem> {
  return dataOf<SavedItem>(await fetch(`/api/saved/${encodeURIComponent(id)}`, json("PATCH", change)));
}

/** Sends a file for a to-do of your own, answering it, for the to-do to name by its id. */
export async function uploadNoteFile(file: File): Promise<NoteFile> {
  const response = await fetch(`${NOTE_FILES_PATH}?name=${encodeURIComponent(file.name)}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  return dataOf<NoteFile>(response);
}
