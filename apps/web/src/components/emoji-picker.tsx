import { memo, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { REACTIONS } from "@ember/protocol";
import { EMOJI_CATEGORIES, type PickerEmoji } from "@ember/protocol/emoji";
import { Search } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";

// The emoji picker, which a popover or a bottom sheet holds: a search, the emoji used most here, and
// every emoji by category. Its emoji come with it, in a chunk of their own that loads as it first shows.

const FREQUENT_KEY = "ember:frequent-emoji";
/** How many emoji the browser remembers using, of which the picker shows two rows. */
const FREQUENT_KEPT = 32;

/** Each emoji used here and how often, most used first, or the reactions' to start with. */
type Frequent = Array<[emoji: string, uses: number]>;

function savedFrequent(): Frequent {
  try {
    const saved = JSON.parse(localStorage.getItem(FREQUENT_KEY) ?? "null") as unknown;
    if (Array.isArray(saved) && saved.every((entry) => Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number")) return saved as Frequent;
  } catch {
    // Storage can be unavailable, or hold something else; the reactions stand in.
  }
  return REACTIONS.map(([emoji]) => [emoji, 0]);
}

/** `frequent` with `emoji` used once more, ahead of those used as often. */
function usedOnce(frequent: Frequent, emoji: string): Frequent {
  const uses = (frequent.find(([used]) => used === emoji)?.[1] ?? 0) + 1;
  const others = frequent.filter(([used]) => used !== emoji);
  const ahead = others.findIndex(([, count]) => count <= uses);
  const at = ahead === -1 ? others.length : ahead;
  return [...others.slice(0, at), [emoji, uses] as [string, number], ...others.slice(at)].slice(0, FREQUENT_KEPT);
}

function saveFrequent(frequent: Frequent): void {
  try {
    localStorage.setItem(FREQUENT_KEY, JSON.stringify(frequent));
  } catch {
    // Storage can be unavailable; the picker still shows the emoji until it closes.
  }
}

const EVERY_EMOJI = EMOJI_CATEGORIES.flatMap(({ emoji }) => emoji);
const NAMES = new Map(EVERY_EMOJI.map(([emoji, ...names]) => [emoji, names]));
const CATEGORIES: readonly Section[] = EMOJI_CATEGORIES.map(({ name, emoji }) => ({ label: name, emoji: emoji.map(([text]) => text) }));

/**
 * How well `name` matches `query`, lower being better: the name itself, then one starting with it, then
 * one with a word starting with it, as "thumbs" finds `thumbsup` and "face" `slightly_smiling_face`, then
 * one with it anywhere; or null for no match.
 */
function matchOf(name: string, query: string): number | null {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.split(/[_-]/).some((word) => word.startsWith(query))) return 2;
  return name.includes(query) ? 3 : null;
}

/** The emoji whose short names match what's searched, as `:tada:` or "slightly smiling" would be written. */
function searchEmoji(search: string): PickerEmoji[] {
  const query = search.trim().toLowerCase().replace(/^:|:$/g, "").replace(/\s+/g, "_");
  if (!query) return [];
  const matches: Array<{ emoji: PickerEmoji; match: number }> = [];
  for (const emoji of EVERY_EMOJI) {
    const [, ...names] = emoji;
    const match = Math.min(...names.map((name) => matchOf(name, query) ?? Infinity));
    if (match !== Infinity) matches.push({ emoji, match });
  }
  // Sorting is stable, so those that match as well keep Unicode's order.
  return matches.sort((a, b) => a.match - b.match).map(({ emoji }) => emoji);
}

interface Section {
  /** The category's name, or none for what's searched. */
  label?: string;
  emoji: readonly string[];
}

/** An emoji's key in the picker, where the frequently used and their categories both show it. */
const keyOf = (section: number, emoji: string) => `${section}:${emoji}`;

export interface EmojiPickerProps {
  /** Called with the emoji picked, by a click or a tap, or Enter. */
  onPick: (emoji: string) => void;
  /** Called on Escape. */
  onClose?: () => void;
  /** How many emoji a row holds, each at least 36px wide, or 44px on touch screens. */
  columns?: number;
  /** Whether the search field takes focus as the picker shows, which raises a phone's keyboard. */
  autoFocus?: boolean;
  /** Its size, 22rem tall unless this says otherwise. */
  className?: string;
}

/** The emoji to search, or browse by category, and pick from, by pointer or keyboard. */
export function EmojiPicker({ onPick, onClose, columns = 8, autoFocus = true, className }: EmojiPickerProps) {
  const id = useId();
  const searchBox = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [frequent, setFrequent] = useState(savedFrequent);
  // The emoji the keyboard last moved to, which Tab reaches; until it moves, the first.
  const [roving, setRoving] = useState<string | null>(null);
  // The category Tab reaches, one stop for them all, which the arrows move between.
  const [categoryStop, setCategoryStop] = useState(0);
  const categoryBar = useRef<HTMLDivElement>(null);

  const sections = useMemo<Section[]>(() => {
    if (search.trim()) return [{ emoji: searchEmoji(search).map(([emoji]) => emoji) }];
    return [{ label: "Frequently used", emoji: frequent.slice(0, columns * 2).map(([emoji]) => emoji) }, ...CATEGORIES];
  }, [search, frequent, columns]);

  const shows = (key: string) => sections.some((section, index) => section.emoji.some((emoji) => keyOf(index, emoji) === key));
  const first = sections.findIndex(({ emoji }) => emoji.length > 0);
  const tabStop = roving && shows(roving) ? roving : first === -1 ? null : keyOf(first, sections[first]!.emoji[0]!);

  const pick = (emoji: string) => {
    const next = usedOnce(frequent, emoji);
    setFrequent(next);
    saveFrequent(next);
    onPick(emoji);
  };

  const find = (value: string) => {
    setSearch(value);
    setRoving(null);
    if (grid.current) grid.current.scrollTop = 0;
  };

  // A category's button scrolls its emoji to the top, out of a search if need be, and Tab then reaches its first.
  const jump = (category: number) => {
    const index = category + 1;
    if (search) flushSync(() => find(""));
    const section = grid.current?.querySelectorAll<HTMLElement>("[data-section]")[index];
    if (grid.current && section) grid.current.scrollTop = section.offsetTop;
    setRoving(keyOf(index, CATEGORIES[category]!.emoji[0]!));
    setCategoryStop(category);
  };

  const categoryKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = CATEGORIES.length - 1;
    const to = { ArrowLeft: categoryStop - 1, ArrowRight: categoryStop + 1, Home: 0, End: last }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const category = Math.max(0, Math.min(last, to));
    setCategoryStop(category);
    categoryBar.current?.querySelectorAll("button")[category]?.focus();
  };

  const buttons = () => [...(grid.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]") ?? [])];

  const focusEmoji = (button: HTMLButtonElement | undefined) => {
    if (!button) return;
    setRoving(button.dataset.key!);
    button.focus();
  };

  const searchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusEmoji(buttons().find((button) => button.dataset.key === tabStop));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const emoji = search.trim() ? buttons().find((button) => button.dataset.key === tabStop)?.dataset.emoji : undefined;
      if (emoji) pick(emoji);
    }
  };

  // Arrows move by one, or to the row above or below, through every category's rows; up from the top row
  // goes back to the search. Anything typed goes to the search.
  const gridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-emoji]");
    if (!button) return;
    if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      find(search + event.key);
      searchBox.current?.focus();
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      find(search.slice(0, -1));
      searchBox.current?.focus();
      return;
    }
    const all = buttons();
    const index = all.indexOf(button);
    const rows = [...(grid.current?.querySelectorAll("[data-section]") ?? [])].flatMap((section) => {
      const inSection = [...section.querySelectorAll<HTMLButtonElement>("button[data-emoji]")];
      return Array.from({ length: Math.ceil(inSection.length / columns) }, (_, row) => inSection.slice(row * columns, (row + 1) * columns));
    });
    const row = rows.findIndex((cells) => cells.includes(button));
    const column = rows[row]!.indexOf(button);
    const inRow = (cells: HTMLButtonElement[] | undefined) => cells?.[Math.min(column, cells.length - 1)];
    if (event.key === "ArrowLeft") focusEmoji(all[index - 1]);
    else if (event.key === "ArrowRight") focusEmoji(all[index + 1]);
    else if (event.key === "ArrowDown") focusEmoji(inRow(rows[row + 1]));
    else if (event.key === "ArrowUp" && row === 0) searchBox.current?.focus();
    else if (event.key === "ArrowUp") focusEmoji(inRow(rows[row - 1]));
    else return;
    event.preventDefault();
  };

  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape" && onClose) onClose();
      }}
      // Its sections' sticky names take whatever holds it as their background, a popover's or a sheet's.
      className={cn("flex h-[22rem] flex-col bg-inherit", className)}
    >
      {/* A label, so a tap anywhere on it reaches the field. */}
      <label className="m-2 mb-1 flex flex-none cursor-text items-center gap-2 rounded-[7px] border px-2.5 py-1.5 focus-within:border-foreground focus-within:ring-1 focus-within:ring-foreground touch:min-h-11">
        <Search className="size-4 flex-none text-muted-foreground" />
        <input
          ref={searchBox}
          type="search"
          value={search}
          placeholder="Search emoji"
          aria-label="Search emoji"
          autoComplete="off"
          autoFocus={autoFocus}
          data-ember-preserve-selection
          onChange={(event) => find(event.target.value)}
          onKeyDown={searchKeyDown}
          className="w-full min-w-0 bg-transparent p-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none touch:text-base [&::-webkit-search-cancel-button]:appearance-none"
        />
      </label>
      <div ref={categoryBar} role="toolbar" aria-label="Categories" onKeyDown={categoryKeyDown} className="flex flex-none px-2">
        {CATEGORIES.map(({ label, emoji }, category) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            tabIndex={category === categoryStop ? 0 : -1}
            onClick={() => jump(category)}
            className="flex h-8 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[6px] text-lg leading-none hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground touch:h-11"
          >
            {emoji[0]}
          </button>
        ))}
      </div>
      <div
        ref={grid}
        role="group"
        aria-label="Emoji"
        onKeyDown={gridKeyDown}
        onClick={(event) => {
          const emoji = (event.target as Element).closest<HTMLButtonElement>("button[data-emoji]")?.dataset.emoji;
          if (emoji) pick(emoji);
        }}
        className="relative min-h-0 flex-auto overflow-y-auto overscroll-contain bg-inherit px-2 pb-2 [scrollbar-gutter:stable]"
      >
        {/* As wide as its rows whatever's shown, so a search finding little or nothing doesn't narrow it. */}
        <div style={{ "--columns": columns } as CSSProperties} className="min-w-[calc(var(--columns)*2.25rem)] bg-inherit touch:min-w-[calc(var(--columns)*2.75rem)]">
          {sections.map((section, index) => (
            <EmojiSection key={section.label ?? "search"} section={section} index={index} labelId={`${id}_${index}`} columns={columns} tabStop={tabStop?.startsWith(`${index}:`) ? tabStop : null} />
          ))}
          {first === -1 && <p className="py-6 text-center text-sm text-muted-foreground">No emoji match</p>}
        </div>
      </div>
    </div>
  );
}

interface EmojiSectionProps {
  section: Section;
  /** Where it is among the picker's sections, which its emoji's keys start with. */
  index: number;
  labelId: string;
  columns: number;
  /** The emoji of this section's that Tab reaches, if one of its is. */
  tabStop: string | null;
}

/**
 * A category's emoji, or what's searched, which draws again only when its own change, rather than with
 * every move of the keyboard through the rest. The picker takes their clicks.
 */
const EmojiSection = memo(function EmojiSection({ section, index, labelId, columns, tabStop }: EmojiSectionProps) {
  return (
    <div data-section role={section.label ? "group" : undefined} aria-labelledby={section.label ? labelId : undefined} className="bg-inherit">
      {section.label && (
        <div id={labelId} className="sticky top-0 z-10 bg-inherit py-1.5 text-xs font-semibold text-muted-foreground">
          {section.label}
        </div>
      )}
      <div className="grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {section.emoji.map((emoji) => {
          const key = keyOf(index, emoji);
          return (
            <button
              key={key}
              type="button"
              data-emoji={emoji}
              data-key={key}
              title={`:${NAMES.get(emoji)?.[0] ?? emoji}:`}
              tabIndex={key === tabStop ? 0 : -1}
              className="flex h-9 w-full min-w-9 cursor-pointer scroll-mt-8 items-center justify-center rounded-[6px] text-[22px] leading-none hover:bg-hover focus-visible:bg-hover touch:h-11 touch:min-w-11"
            >
              {emoji}
            </button>
          );
        })}
      </div>
    </div>
  );
});
