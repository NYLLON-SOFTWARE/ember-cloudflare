import { useState } from "react";
import type { CustomEmoji } from "@ember/protocol";
import { fetchCustomEmoji } from "@/lib/api";
import { NO_CUSTOM_EMOJI, type CustomEmojiByName } from "./use-custom-emoji";
import { oneAtATime } from "./use-sidebar";

/** What happened to an emoji while a load was on its way, which may have listed them before it did. */
type Change = { added: CustomEmoji } | { removed: string };

function withChanges(emoji: CustomEmojiByName, changes: Change[]): CustomEmojiByName {
  const next = new Map(emoji);
  for (const change of changes) {
    if ("added" in change) next.set(change.added.name, change.added);
    else next.delete(change.removed);
  }
  return next;
}

/** The workspace's custom emoji, as far as the workspace socket keeps them current. */
export interface CustomEmojiList {
  emoji: CustomEmojiByName;
  /** Loads them again, one load at a time, as the sidebar does each time its socket connects. */
  reload: () => Promise<void>;
  /** Lists one, as the socket or adding it here says it was added. */
  add: (emoji: CustomEmoji) => void;
  /** Lists one no longer, as the socket or removing it here says. */
  remove: (name: string) => void;
}

/**
 * The workspace's custom emoji, as `useDirectory` keeps the people directory: `reload` loads them again,
 * and `add` and `remove` change them as the workspace socket or a change made here says. They stay as
 * they were when a load fails.
 */
export function useCustomEmojiList(): CustomEmojiList {
  const [emoji, setEmoji] = useState<CustomEmojiByName>(NO_CUSTOM_EMOJI);
  const [list] = useState(() => {
    let changedSince: Change[] | null = null;
    const change = (change: Change) => {
      changedSince?.push(change);
      setEmoji((emoji) => withChanges(emoji, [change]));
    };
    const reload = oneAtATime(async () => {
      const changes: Change[] = (changedSince = []);
      try {
        const loaded = await fetchCustomEmoji();
        setEmoji(withChanges(new Map(loaded.map((emoji) => [emoji.name, emoji])), changes));
      } finally {
        changedSince = null;
      }
    });
    return { reload, add: (added: CustomEmoji) => change({ added }), remove: (removed: string) => change({ removed }) };
  });
  return { emoji, ...list };
}
