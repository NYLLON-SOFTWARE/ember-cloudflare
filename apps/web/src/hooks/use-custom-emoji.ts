import { createContext, useContext } from "react";
import type { CustomEmoji } from "@ember/protocol/custom-emoji";

// Only the emoji as the app keeps them, which the editor's chunk reads too: loading them is
// use-custom-emoji-list.ts's, whose imports would split the app's script (`oneAppScript` in vite.config.ts).

/** The workspace's custom emoji by name, as last listed. */
export type CustomEmojiByName = ReadonlyMap<string, CustomEmoji>;

export const NO_CUSTOM_EMOJI: CustomEmojiByName = new Map();

/** The workspace's custom emoji, for the codes in messages and reactions to find their pictures in. Empty until they load. */
export const CustomEmojiContext = createContext<CustomEmojiByName>(NO_CUSTOM_EMOJI);

export const useCustomEmoji = () => useContext(CustomEmojiContext);
