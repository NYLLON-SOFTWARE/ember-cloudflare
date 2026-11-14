import type { ReactNode } from "react";
import { customEmojiImagePath, customEmojiNameIn, emojiCode, emojiSegments, type CustomEmoji } from "@ember/protocol/custom-emoji";
import { useCustomEmoji, type CustomEmojiByName } from "@/hooks/use-custom-emoji";
import { cn } from "@/lib/utils";

// The editor's chunk draws custom emoji too, in the list of emoji a code finds, so what's here imports
// nothing the app's script doesn't share with it already (`oneAppScript` in vite.config.ts).

/**
 * A custom emoji's picture, in place of its code: as tall as Slack draws one in a line of text, and
 * named by its code, which is what copying it copies.
 */
export function CustomEmojiImage({ emoji, className }: { emoji: CustomEmoji; className?: string }) {
  const code = emojiCode(emoji.name);
  return (
    <img
      src={customEmojiImagePath(emoji.key)}
      alt={code}
      title={code}
      draggable={false}
      className={cn("inline-block size-[1.375em] object-contain align-[-0.3em]", className)}
    />
  );
}

/** `text` with the picture of each custom emoji whose code it holds in the code's place. */
export function withEmojiDrawn(text: string, emoji: CustomEmojiByName): ReactNode {
  // Most text holds no colon, and most workspaces start with no custom emoji.
  if (emoji.size === 0 || !text.includes(":")) return text;
  const segments = emojiSegments(text, (name) => emoji.get(name));
  if (segments.length === 1 && typeof segments[0] === "string") return text;
  return segments.map((segment, position) => (typeof segment === "string" ? segment : <CustomEmojiImage key={position} emoji={segment} />));
}

/** The custom emoji `text` is the code of and nothing else, as a reaction of one is, if the workspace has it. */
export const onlyCustomEmoji = (text: string, emoji: CustomEmojiByName): CustomEmoji | undefined => {
  const name = emoji.size === 0 ? null : customEmojiNameIn(text);
  return name === null ? undefined : emoji.get(name);
};

/** An emoji as a search lists it (`withCustomEmoji` in lib/emoji.ts): a custom one's picture for its code, or the emoji itself. */
export function EmojiGlyph({ emoji }: { emoji: string }) {
  const custom = onlyCustomEmoji(emoji, useCustomEmoji());
  return custom ? <CustomEmojiImage emoji={custom} className="size-[1em] align-baseline" /> : emoji;
}
