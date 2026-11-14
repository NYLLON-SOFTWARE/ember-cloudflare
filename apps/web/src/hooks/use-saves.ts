import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { RoomId, SavedItem } from "@ember/protocol";
import { ApiError, forgetSave as forgetOnServer, fetchSaves, saveForLater } from "@/lib/api";

// The messages someone has saved for later, which the rail's count, the Saved pane and More actions
// share. The list is asked for when the page loads, and again after a save or a remove made here;
// what another tab does isn't heard of until it loads again.

/** What the workspace keeps of someone's saves. */
export interface Saver {
  /** The messages saved, newest save first, or null while the list is on its way. */
  saves: SavedItem[] | null;
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
  // Asked when the page loads, and again after a save or a remove here.
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    let stopped = false;
    fetchSaves().then(
      (answer) => !stopped && setSaves(answer.saves),
      (error: unknown) => !stopped && onFailed(error),
    );
    return () => void (stopped = true);
  }, [asked, onFailed]);
  const askAgain = useCallback(() => setAsked((asked) => asked + 1), []);

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
      setSaves((saved) => saved?.filter((save) => save.id !== id) ?? null);
      try {
        await forgetOnServer(id);
      } catch (error) {
        // What the server kept comes back with the list it answers next.
        onFailed(error);
        askAgain();
      }
    },
    [askAgain, onFailed],
  );

  const saveOf = useCallback((messageId: string) => saves?.find((save) => save.messageId === messageId) ?? null, [saves]);
  return useMemo(() => ({ saves, save, forget, saveOf }), [saves, save, forget, saveOf]);
}
