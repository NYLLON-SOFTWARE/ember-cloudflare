import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { RoomId, SavedItem } from "@ember/protocol";
import { ApiError, forgetSave as forgetOnServer, fetchSaves, saveForLater } from "@/lib/api";

// The messages someone has saved for later, which the rail's count, the Saved pane and More actions
// share. The list is asked for when the page loads, and again after a save or a remove made here or in
// another tab (which the workspace socket's `saves.changed` says), and when the pane opens asking for
// what a failed ask never brought.

/** What the workspace keeps of someone's saves. */
export interface Saver {
  /** The messages saved, newest save first, or null while the list is on its way. */
  saves: SavedItem[] | null;
  /** Asks for the list again, as opening the pane does, which a failed ask never brought. */
  load: () => void;
  /** Saves the message `messageId` of room `roomId` for later, then follows what the server keeps. */
  save: (roomId: RoomId, messageId: string) => Promise<void>;
  /** Forgets the save `id`, taking it out at once, so the count and the pane move before the server has answered. */
  forget: (id: string) => Promise<void>;
  /** The save of the message `messageId`, or null while none is. */
  saveOf: (messageId: string) => SavedItem | null;
}

/** The saves of whoever the workspace is signed in as, which More actions reads wherever a message shows. */
export const SavesContext = createContext<Saver | null>(null);

/** The saves of whoever the workspace is signed in as, or null outside it, as a message's actions ask. */
export const useSaver = (): Saver | null => useContext(SavesContext);

export function useSaves(onFailed: (error: unknown) => void): Saver {
  const [saves, setSaves] = useState<SavedItem[] | null>(null);
  // Asked when the page loads, and again after a save or a remove here, or when the pane opens for
  // what a failed ask never brought.
  const [asked, setAsked] = useState(0);
  // What a remove here has taken out of the list since it was asked for, counted once as it goes and
  // again once the server has heard of it, since a list asked for in between may still hold it: an
  // answer that set out before either count is left, and a fresh list asked for.
  const changed = useRef(0);
  const askAgain = useCallback(() => setAsked((asked) => asked + 1), []);
  useEffect(() => {
    let stopped = false;
    const unchanged = changed.current;
    fetchSaves().then(
      (answer) => {
        if (stopped) return;
        if (changed.current !== unchanged) askAgain();
        else setSaves(answer.saves);
      },
      (error: unknown) => !stopped && onFailed(error),
    );
    return () => void (stopped = true);
  }, [asked, askAgain, onFailed]);

  const save = useCallback(
    async (roomId: RoomId, messageId: string) => {
      try {
        await saveForLater(roomId, messageId);
      } catch (error) {
        // A message saved already is saved all the same, so the list follows rather than complaining.
        if (!(error instanceof ApiError && error.status === 409)) {
          onFailed(error);
          return;
        }
      }
      askAgain();
    },
    [askAgain, onFailed],
  );

  const forget = useCallback(
    async (id: string) => {
      changed.current++;
      setSaves((saved) => saved?.filter((save) => save.id !== id) ?? null);
      try {
        await forgetOnServer(id);
      } catch (error) {
        // What the server kept comes back with the list it answers next.
        onFailed(error);
        askAgain();
      }
      // However the server answers, a list asked for before now may not know of the remove, so none
      // on its way tells of the saves any more.
      changed.current++;
    },
    [askAgain, onFailed],
  );

  const saveOf = useCallback((messageId: string) => saves?.find((save) => save.messageId === messageId) ?? null, [saves]);
  return useMemo(() => ({ saves, load: askAgain, save, forget, saveOf }), [saves, askAgain, save, forget, saveOf]);
}
