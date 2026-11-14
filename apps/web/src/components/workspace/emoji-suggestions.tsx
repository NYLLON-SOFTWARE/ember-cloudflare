import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SkinTone } from "@ember/protocol";
import { useSkinTone } from "@/hooks/use-skin-tone";
import { loadEmoji, loadedEmoji, recentEmoji, rememberEmoji, searchEmoji, type EmojiIndex, type EmojiMatch } from "@/lib/emoji";
import { cn } from "@/lib/utils";

/** How far the list keeps from what it's for, and from the window's edges. */
const GAP = 6;
/** The room the list needs above what it's for to open there rather than below it. */
const ROOM_ABOVE = 300;

/** The emoji, once a code is typed, which loads them the first time. */
function useEmojiIndex(wanted: boolean): EmojiIndex | null {
  const [index, setIndex] = useState(loadedEmoji);
  useEffect(() => {
    if (!wanted || index) return;
    let current = true;
    // Without them, no list shows, until the next code tries again.
    loadEmoji().then(
      (loaded) => current && setIndex(loaded),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [wanted, index]);
  return index;
}

export interface EmojiSuggestionsState {
  /** Whether the list shows, which it does while what's typed finds an emoji, until Escape shuts it. */
  open: boolean;
  matches: EmojiMatch[];
  /** Which of `matches` Enter or Tab would pick. */
  active: number;
  setActive: (active: number) => void;
  /** Puts the match in place of the code, remembering it as used. */
  pick: (match: EmojiMatch) => void;
  /**
   * Takes the keys an open list answers to: up and down move through it, Enter and Tab pick, and Escape
   * shuts it until the code's left. Returns whether it took the key, whose default it then prevents.
   */
  keyDown: (event: KeyboardEvent) => boolean;
  /** The emoji, once they've loaded, for the codes a colon closes. */
  index: EmojiIndex | null;
  /** Your skin tone, which emoji of people and hands come in. */
  skinTone: SkinTone;
}

/**
 * The emoji Slack's way of typing them lists for `typed`, what's typed of a code after its colon, or
 * null while no code is being typed. `onPick` puts an emoji in the code's place.
 */
export function useEmojiSuggestions(typed: string | null, onPick: (match: EmojiMatch) => void): EmojiSuggestionsState {
  const index = useEmojiIndex(typed !== null);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [recent, setRecent] = useState(recentEmoji);
  const skinTone = useSkinTone();
  const matches = index && typed !== null ? searchEmoji(index, typed, recent, skinTone) : [];
  const open = !dismissed && matches.length > 0;

  // The best match is picked first, each time what's typed changes, and leaving a code ends its Escape.
  const [lastTyped, setLastTyped] = useState(typed);
  if (typed !== lastTyped) {
    setLastTyped(typed);
    setActive(0);
    if (typed === null) setDismissed(false);
  }

  const pick = (match: EmojiMatch) => {
    rememberEmoji(match.base);
    setRecent(recentEmoji());
    onPick(match);
  };

  const keyDown = (event: KeyboardEvent) => {
    if (!open || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return false;
    switch (event.key) {
      case "ArrowDown":
        setActive((active + 1) % matches.length);
        break;
      case "ArrowUp":
        setActive((active - 1 + matches.length) % matches.length);
        break;
      case "Enter":
      case "Tab":
        if (event.shiftKey) return false;
        pick(matches[Math.min(active, matches.length - 1)]!);
        break;
      case "Escape":
        setDismissed(true);
        break;
      default:
        return false;
    }
    event.preventDefault();
    return true;
  };

  return { open, matches, active: Math.min(active, matches.length - 1), setActive, pick, keyDown, index, skinTone };
}

interface Props {
  id: string;
  state: EmojiSuggestionsState;
  /** What's typed of the code, for the list's heading. */
  typed: string;
  /** Where the code is on the page, which the list opens above, or below where there's no room above. */
  anchor: () => DOMRect | null;
  /** The timeline the code's in, if it's in one, whose messages can move it as they change. */
  within?: () => Element | null;
}

/**
 * The emoji a code being typed finds, as Slack lists them: a heading, "Emoji matching :ta", then each
 * emoji with its code, the one Enter would pick highlighted. Pressing on one picks it without taking
 * focus from the text.
 */
export function EmojiSuggestions({ id, state, typed, anchor, within }: Props) {
  const list = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const place = useEffectEvent(() => {
    const rect = anchor();
    const width = list.current?.offsetWidth ?? 0;
    if (!rect) return setPosition(null);
    const left = Math.max(GAP, Math.min(rect.left - GAP, window.innerWidth - width - GAP));
    setPosition(rect.top >= ROOM_ABOVE ? { left, bottom: window.innerHeight - rect.top + GAP } : { left, top: rect.bottom + GAP });
  });

  // Placed after each change to what's typed, since the code moves along the line as it grows.
  useLayoutEffect(() => place(), [typed, state.open]);

  // And again as what it's for moves, as the message actions bar is: the timeline or the page scrolling,
  // but not the list, as it scrolls to the emoji Enter would pick, the window changing size, or what's
  // shown of it, as a phone's keyboard opens, and messages above changing without anything scrolling.
  useEffect(() => {
    if (!state.open) return;
    const events = new AbortController();
    const options = { signal: events.signal };
    document.addEventListener("scroll", (event) => list.current?.contains(event.target as Node) || place(), { ...options, capture: true, passive: true });
    window.addEventListener("resize", () => place(), options);
    window.visualViewport?.addEventListener("resize", () => place(), options);
    const changed = new MutationObserver(() => place());
    const timeline = within?.();
    if (timeline) changed.observe(timeline, { childList: true, characterData: true, subtree: true });
    return () => {
      events.abort();
      changed.disconnect();
    };
  }, [state.open]);

  useLayoutEffect(() => {
    document.getElementById(`${id}-${state.active}`)?.scrollIntoView({ block: "nearest" });
  }, [id, state.active]);

  if (!state.open) return null;

  return createPortal(
    <div
      ref={list}
      className={cn(
        "fixed z-50 w-72 max-w-[calc(100vw-12px)] rounded-[11px] border border-message-border bg-background p-1 text-message-ink shadow-[0_4px_16px_#0000001f]",
        !position && "invisible",
      )}
      style={position ?? undefined}
      // Keeps focus, and the cursor, in the text.
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className="flex items-baseline justify-between gap-2 px-2 pt-1 pb-1.5 text-[11px] leading-normal text-muted-foreground">
        <span className="min-w-0 truncate">
          Emoji matching <strong className="font-semibold text-message-ink">:{typed}</strong>
        </span>
        <span className="shrink-0 touch:hidden" aria-hidden>
          tab or ↵ to pick
        </span>
      </div>
      <ul id={id} role="listbox" aria-label={`Emoji matching :${typed}`} className="max-h-[17.5rem] overflow-y-auto overscroll-contain">
        {state.matches.map((match, position) => (
          <li
            key={match.base}
            id={`${id}-${position}`}
            role="option"
            aria-selected={position === state.active}
            aria-label={`${match.emoji} :${match.code}:`}
            className="flex h-8 cursor-pointer items-center gap-2.5 rounded-[6px] px-2 text-sm aria-selected:bg-hover touch:h-11"
            onPointerMove={() => state.setActive(position)}
            onClick={() => state.pick(match)}
          >
            <span aria-hidden className="w-6 shrink-0 text-center text-[1.25rem] leading-none">
              {match.emoji}
            </span>
            <span className="min-w-0 truncate">:{match.code}:</span>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
