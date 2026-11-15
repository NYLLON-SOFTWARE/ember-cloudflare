import { useContext, useEffect, useEffectEvent, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  hasFilters,
  isSearchable,
  normalizedSearch,
  SEARCH_FLAGS,
  searchPath,
  type DirectoryUser,
  type Me,
  type Room,
  type Search,
  type SearchFilters,
  type SearchFlag,
  type User,
  type UserId,
} from "@ember/protocol";
import { Attachment, ClockRotateRight, FilterList, Hashtag, Plus, Search as SearchIcon, Trash, User as UserIcon } from "@/components/icons/iconoir";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PeopleContext } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { afterNavigating, navigate, pageMark } from "@/hooks/use-route";
import { clearSearches, fetchSearch, isSignedOut, recordSearch } from "@/lib/api";
import { opensFind } from "@/lib/keyboard";
import { FLAG_LABELS, keepAnswer, modifierTyped, withoutFlag, withoutFromMe, withTypedFilters, type TypedModifier } from "@/lib/search";
import { cn } from "@/lib/utils";
import { returnFocus } from "./dialog-openers";
import { UserAvatar } from "./user-avatar";
import {
  CHIPS_ROW,
  Chip,
  CONFIRM_CLEAR_SEARCHES,
  FLAG_ICONS,
  filtersOf,
  RoomMark,
  SearchLine,
  searchLabel,
  SearchTokens,
  useSearchNames,
  type SearchBoxOptions,
  type SearchNames,
} from "./search-box";

// The search box, as Slack's is, which opens over the page from the rail, a room's header or the results
// page: a chunk of its own, with the pages few visits need (pages.ts).

/** How many rooms or people a modifier being typed offers. */
const COMPLETIONS = 8;

/** How many recent searches show while words are typed: those with the words in them. */
const RECENT_MATCHES = 5;

/** A row of the box's list, which the arrows move through and Enter picks. */
type Option =
  | { kind: "search"; id: string }
  | { kind: "recent"; id: string; search: Search }
  | { kind: "room"; id: string; room: Room }
  | { kind: "person"; id: string; person: User }
  | { kind: "flag"; id: string; flag: SearchFlag };


/** A button in the box's field row that holds only an icon, pressed while what it shows is shown. */
const FIELD_BUTTON =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground aria-pressed:bg-hover aria-pressed:text-foreground touch:size-11 [&>svg]:size-[18px]";

/** A key, as the box's footer and its options show the keys that work them. */
function Key({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-sans text-[11px] text-muted-foreground">{children}</kbd>;
}

interface Props extends SearchBoxOptions {
  me: Me;
  /** The rooms the sidebar lists, which `in:` offers and the tokens name. */
  rooms: readonly Room[];
  /** Called once it has closed. */
  onClose: () => void;
  /** Hears why a search failed, or that the session has ended. */
  onFailed: (error: unknown) => void;
}

/**
 * The search box: a field holding the search's filters as tokens before its words, the quick filters
 * under it as chips, and a list that the arrows move through and Enter picks from: Show results for
 * the search, which Enter picks at first, and your recent searches, or, while a modifier such as `in:`
 * or `from:` is typed, what it can name. A search records itself as your newest and opens its results.
 * Cmd+F or Ctrl+F in the box closes it and leaves the key to the browser, which finds in the page.
 */
export function SearchBox({ opener, search: start, sort = "newest", roomId, me, rooms, onClose, onFailed }: Props) {
  const names = useSearchNames(me, rooms);
  const people = useContext(PeopleContext);
  const mounted = useMounted();
  const listId = useId();
  const field = useRef<HTMLInputElement>(null);
  const here = useMemo(() => (roomId ? (rooms.find((room) => room.id === roomId) ?? null) : null), [rooms, roomId]);
  const [open, setOpen] = useState(true);
  // In the room it opened in, even one the sidebar has yet to list, as it hasn't while it loads.
  const [filters, setFilters] = useState<SearchFilters>(() => (start ? filtersOf(start) : roomId ? { in: roomId } : {}));
  const [typed, setTyped] = useState(start?.q ?? "");
  const [chipsShown, setChipsShown] = useState(true);
  const [moreShown, setMoreShown] = useState(false);
  const [recentShown, setRecentShown] = useState(true);
  const [recent, setRecent] = useState<Search[] | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // Whether it closed to show what it found, where the results page takes focus.
  const went = useRef(false);

  // Your recent searches load as it opens.
  useEffect(() => {
    fetchSearch({ q: "" }).then(
      (results) => mounted.current && setRecent(results.recent),
      (error: unknown) => isSignedOut(error) && onFailed(error),
    );
  }, [mounted, onFailed]);

  // Going Back or Forward closes it too.
  const historyMoved = useEffectEvent(() => setOpen(false));
  useEffect(() => {
    const listener = () => historyMoved();
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);

  const search = withTypedFilters({ ...filters, q: typed }, me.id);
  const searchable = isSearchable(search);
  const modifier = useMemo(() => modifierTyped(typed), [typed]);
  const options = useMemo(
    () => (modifier ? completionsOf(modifier, me, rooms, people.values(), names) : suggestionsOf(searchable, typed, recentShown ? recent : null)),
    [modifier, me, rooms, people, names, searchable, typed, recentShown, recent],
  );
  // Until the arrows or the pointer pick another, Enter picks Show results for, or what a modifier names first.
  const picked = options.some((option) => option.id === highlighted) ? highlighted : modifier ? (options[0]?.id ?? null) : searchable ? "search" : null;
  const optionId = (id: string) => `${listId}-${id}`;

  const focusField = () => field.current?.focus();
  const type = (value: string) => {
    setTyped(value);
    setHighlighted(null);
  };
  const changeFilters = (change: (filters: SearchFilters) => SearchFilters) => {
    setFilters(change);
    setHighlighted(null);
    focusField();
  };
  const remove = (filter: keyof SearchFilters) => changeFilters(({ [filter]: _, ...rest }) => rest);
  const scopeTo = (change: SearchFilters) => changeFilters((filters) => ({ ...filters, ...change }));
  // A chip is pressed while the search has its filter, as a token or a modifier typed in full, such as
  // `has:link`, and turning it off takes away both.
  const toggle = (flag: SearchFlag) => {
    if (search[flag] !== true) return scopeTo({ [flag]: true });
    type(withoutFlag(typed, flag));
    remove(flag);
  };
  // From me likewise, but turning it off leaves a person picked, whom a from:me typed was winning over.
  const fromMe = search.from === me.id;
  const toggleFromMe = () => {
    if (!fromMe) return scopeTo({ from: me.id });
    type(withoutFromMe(typed));
    if (filters.from === me.id) remove("from");
    focusField();
  };
  // From someone and In a room type their modifier after the words, for its completions to show.
  const startModifier = (key: "in" | "from") => {
    type(`${typed.trimEnd()}${typed.trim() === "" ? "" : " "}${key}:`);
    setMoreShown(false);
    focusField();
  };

  /** Searches for `chosen`, recording it as your newest, and shows what it finds. */
  const run = (chosen: Search) => {
    const asked = normalizedSearch(chosen);
    if (!isSearchable(asked) || searching) return;
    const mark = pageMark();
    setSearching(true);
    recordSearch(asked, sort).then(
      (results) => {
        if (!mounted.current) return;
        // A page the person has gone to meanwhile stays, with the box over it to search again.
        if (pageMark() !== mark) return setSearching(false);
        went.current = true;
        setOpen(false);
        navigate(searchPath(asked, sort));
        // For the results page once the app goes there, but not if unsaved changes keep it here, so a
        // later visit to the same search asks afresh.
        afterNavigating(() => keepAnswer(asked, sort, results));
      },
      (error: unknown) => {
        if (mounted.current) setSearching(false);
        if (mounted.current || isSignedOut(error)) onFailed(error);
      },
    );
  };

  /** Runs a search, or takes what a modifier names as a filter, in place of the modifier. */
  const pick = (option: Option) => {
    const before = modifier ? typed.slice(0, modifier.start).trimEnd() : typed;
    switch (option.kind) {
      case "search":
        return run(search);
      case "recent":
        return run(option.search);
      case "room":
        type(before);
        return scopeTo({ in: option.room.id });
      case "person":
        // In place of a from:me typed before, which would otherwise win as the search is made.
        type(withoutFromMe(before));
        return scopeTo({ from: option.person.id });
      case "flag":
        type(before);
        return scopeTo({ [option.flag]: true });
    }
  };

  // Asked first, and then gone from the list.
  const clear = () => {
    if (!confirm(CONFIRM_CLEAR_SEARCHES)) return;
    clearSearches().then(
      () => mounted.current && setRecent([]),
      (error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error),
    );
    focusField();
  };

  // The arrows move through the list, round from either end, Enter picks what's highlighted, or else runs
  // the search, and Backspace at the field's start takes the last token away.
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
      event.preventDefault();
      const index = options.findIndex((option) => option.id === picked);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = options[index === -1 ? (step > 0 ? 0 : options.length - 1) : (index + step + options.length) % options.length]!;
      setHighlighted(next.id);
      document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options.find((option) => option.id === picked);
      if (option) pick(option);
      else run(search);
    } else if (event.key === "Backspace" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
      const last = lastFilter(filters);
      if (last) remove(last);
    }
  };

  const inHere = here !== null && filters.in === here.id;
  const recentHeading = !modifier && recentShown && typed === "" && recent !== null && recent.length > 0;

  return (
    <Dialog open={open} onOpenChange={(open) => open || setOpen(false)}>
      <DialogContent
        data-ember-search-box
        showCloseButton={false}
        overlayClassName="bg-dialog-backdrop"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const input = field.current;
          input?.focus();
          input?.setSelectionRange(input.value.length, input.value.length);
        }}
        // Focus goes back to the link that opened it, or, for a key, to where it was, but the results it opens take it.
        onCloseAutoFocus={(event) => {
          if (went.current || opener) event.preventDefault();
          if (!went.current && opener) returnFocus(opener);
          onClose();
        }}
        // Cmd+F again is the browser's, to find in the page, once the box has gone.
        onKeyDown={(event) => {
          if (opensFind(event.nativeEvent)) setOpen(false);
        }}
        // As tall as the screen leaves it at most, where the list gives up its height first, as on a phone on its
        // side, and wide enough for the chips on one line, In this conversation's among them.
        className="top-[max(12px,8dvh,env(safe-area-inset-top))] flex max-h-[calc(100dvh-max(12px,8dvh,env(safe-area-inset-top))-max(12px,env(safe-area-inset-bottom)))] w-[768px] max-w-[calc(100dvw-24px-env(safe-area-inset-left)-env(safe-area-inset-right))] translate-y-0 flex-col gap-0 overflow-hidden rounded-[14px] p-0 text-foreground shadow-[0_24px_80px_var(--color-dialog-shadow)] sm:max-w-[calc(100dvw-24px-env(safe-area-inset-left)-env(safe-area-inset-right))]"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search messages in your rooms and direct messages, or narrow a search with the filters.</DialogDescription>
        {/* The search's tokens and then its words, which wrap onto lines of their own, then Clear and the toggles. */}
        <div aria-busy={searching || undefined} className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2 max-md:px-3">
          <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
          {/* A label, so a tap anywhere among the tokens reaches the field. */}
          <label className="flex min-w-0 flex-1 cursor-text flex-wrap items-center gap-1.5">
            <SearchTokens filters={filters} names={names} onRemove={remove} />
            <input
              ref={field}
              type="text"
              value={typed}
              aria-label="Search"
              placeholder="Search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={options.length > 0}
              aria-controls={listId}
              aria-activedescendant={picked ? optionId(picked) : undefined}
              onChange={(event) => type(event.target.value)}
              onKeyDown={keyDown}
              className="min-w-[8ch] flex-1 bg-transparent py-1 text-[15px] outline-none placeholder:text-muted-foreground touch:min-h-11 touch:text-base"
            />
          </label>
          {(typed !== "" || hasFilters(filters)) && (
            <button
              type="button"
              onClick={() => {
                type("");
                changeFilters(() => ({}));
              }}
              className="shrink-0 cursor-pointer rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground hover:bg-hover hover:text-foreground touch:min-h-11"
            >
              Clear
            </button>
          )}
          {/* A phone's narrow screen leaves the field the room the toggles would take. */}
          <span className="flex shrink-0 items-center gap-2 upto-500px:hidden">
            <span aria-hidden className="h-5 w-px bg-border" />
            <button type="button" aria-pressed={chipsShown} aria-label="Filters" title="Filters" onClick={() => setChipsShown((shown) => !shown)} className={FIELD_BUTTON}>
              <FilterList />
            </button>
            <button
              type="button"
              aria-pressed={recentShown}
              aria-label="Recent searches"
              title="Recent searches"
              onClick={() => {
                setRecentShown((shown) => !shown);
                focusField();
              }}
              className={FIELD_BUTTON}
            >
              <ClockRotateRight />
            </button>
          </span>
        </div>

        {chipsShown && (
          <div role="group" aria-label="Search filters" className={cn("flex shrink-0 gap-2 border-b px-4 py-2.5", CHIPS_ROW)}>
            {here && (
              <Chip pressed={inHere} onClick={() => (inHere ? remove("in") : scopeTo({ in: here.id }))}>
                <RoomMark room={here} size={16} />
                {here.kind === "direct" ? "In this conversation" : "In this room"}
              </Chip>
            )}
            <Chip pressed={fromMe} onClick={toggleFromMe}>
              <UserIcon />
              From me
            </Chip>
            {(["withMe", "hasLink", "inThread"] as const).map((flag) => {
              const Icon = FLAG_ICONS[flag];
              return (
                <Chip key={flag} pressed={search[flag] === true} onClick={() => toggle(flag)}>
                  <Icon />
                  {FLAG_LABELS[flag]}
                </Chip>
              );
            })}
            {moreShown && (
              <>
                <Chip pressed={search.hasFile === true} onClick={() => toggle("hasFile")}>
                  <Attachment />
                  {FLAG_LABELS.hasFile}
                </Chip>
                <Chip onClick={() => startModifier("from")}>
                  <UserIcon />
                  From someone…
                </Chip>
                <Chip onClick={() => startModifier("in")}>
                  <Hashtag />
                  In a room…
                </Chip>
              </>
            )}
            <Chip aria-expanded={moreShown} aria-label="More filters" onClick={() => setMoreShown((shown) => !shown)}>
              <Plus />
            </Chip>
          </div>
        )}

        <div className="max-h-[min(380px,45dvh)] overflow-y-auto overscroll-contain p-2">
          {recentHeading && (
            <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-1">
              <h2 className="text-xs font-semibold text-muted-foreground">Recent searches</h2>
              <button
                type="button"
                aria-label="Clear recent searches"
                onClick={clear}
                className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-hover hover:text-foreground touch:min-h-11"
              >
                <Trash className="size-3.5" />
                Clear
              </button>
            </div>
          )}
          <div id={listId} role="listbox" aria-label={modifier ? completionsLabel(modifier) : "Suggestions"}>
            {options.map((option) => (
              <div
                key={option.id}
                id={optionId(option.id)}
                role="option"
                aria-selected={option.id === picked}
                aria-label={optionLabel(option, search, names)}
                // The field keeps focus as an option's clicked.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option)}
                onMouseMove={() => option.id !== picked && setHighlighted(option.id)}
                className="flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-[14px] text-foreground aria-selected:bg-hover touch:min-h-11"
              >
                <OptionContent option={option} search={search} names={names} me={me} />
              </div>
            ))}
          </div>
          {options.length === 0 && (
            <p className="px-2 py-2 text-[13px] text-muted-foreground">
              {modifier ? nothingToComplete(modifier) : "Search for words, or narrow a search with in:, from:, has:link, has:file, is:thread or with:me."}
            </p>
          )}
        </div>

        {/* The keys, where there's a keyboard. */}
        <footer aria-hidden className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-xs text-muted-foreground max-md:hidden touch:hidden">
          <span className="inline-flex items-center gap-1">
            <Key>↑</Key>
            <Key>↓</Key>
            Select
          </span>
          <span className="inline-flex items-center gap-1">
            <Key>Enter</Key>
            Search
          </span>
          <span className="inline-flex items-center gap-1">
            <Key>Esc</Key>
            Close
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/** What a row of the box's list shows. */
function OptionContent({ option, search, names, me }: { option: Option; search: Search; names: SearchNames; me: Me }) {
  switch (option.kind) {
    case "search":
      return (
        <>
          <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="shrink-0 text-muted-foreground">Show results for</span>
          <SearchLine search={search} names={names} className="font-medium" />
          <span aria-hidden className="ml-auto shrink-0 max-md:hidden touch:hidden">
            <Key>Enter</Key>
          </span>
        </>
      );
    case "recent":
      return (
        <>
          <ClockRotateRight className="size-[18px] shrink-0 text-muted-foreground" />
          <SearchLine search={option.search} names={names} />
        </>
      );
    case "room":
      return (
        <>
          <span className="grid w-[18px] shrink-0 place-items-center text-muted-foreground">
            <RoomMark room={option.room} size={18} />
          </span>
          <span className="truncate">{names.roomName(option.room)}</span>
        </>
      );
    case "person":
      return (
        <>
          <UserAvatar user={option.person} className="size-5 shrink-0" />
          <span className="truncate">{option.person.id === me.id ? `Me (${me.name})` : option.person.name}</span>
        </>
      );
    case "flag": {
      const Icon = FLAG_ICONS[option.flag];
      return (
        <>
          <Icon className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="truncate">{FLAG_LABELS[option.flag]}</span>
        </>
      );
    }
  }
}

/** What screen readers call a row that shows a search as tokens and words, which their content would run together. */
function optionLabel(option: Option, search: Search, names: SearchNames): string | undefined {
  if (option.kind === "search") return `Show results for ${searchLabel(search, names)}`;
  if (option.kind === "recent") return searchLabel(option.search, names);
  return undefined;
}

/** The filter a search's tokens show last, which Backspace at the field's start takes away. */
function lastFilter(filters: SearchFilters): keyof SearchFilters | null {
  const flags = SEARCH_FLAGS.map(({ flag }) => flag).filter((flag) => filters[flag] === true);
  return flags.at(-1) ?? (filters.from !== undefined ? "from" : filters.in !== undefined ? "in" : null);
}

/** What the list is named while a modifier is typed. */
const completionsLabel = ({ key }: TypedModifier) => (key === "in" ? "Rooms" : key === "from" ? "People" : "Filters");

/** What the list says when a modifier being typed names nothing. */
function nothingToComplete({ key }: TypedModifier): string {
  if (key === "in") return "No rooms match.";
  if (key === "from") return "No people match.";
  return "No filters match. Try has:link, has:file, is:thread or with:me.";
}

/**
 * What a modifier being typed can name: the rooms or people whose names have what's typed after it,
 * rooms before DMs and you before anyone else, or the filters whose values start with it.
 */
function completionsOf(modifier: TypedModifier, me: Me, rooms: readonly Room[], people: Iterable<DirectoryUser>, names: SearchNames): Option[] {
  const sought = modifier.value.replace(/^[#@]+/u, "").toLowerCase();
  if (modifier.key === "in") {
    return rooms
      .map((room) => ({ room, direct: room.kind === "direct", name: names.roomName(room) }))
      .filter(({ name }) => name.toLowerCase().includes(sought))
      .sort((a, b) => Number(a.direct) - Number(b.direct) || a.name.localeCompare(b.name))
      .slice(0, COMPLETIONS)
      .map(({ room }) => ({ kind: "room", id: `room-${room.id}`, room }));
  }
  if (modifier.key === "from") {
    const meToo = "me".startsWith(sought) || me.name.toLowerCase().includes(sought) ? [me] : [];
    return [...meToo, ...authorsMatching(people, me.id, sought)].slice(0, COMPLETIONS).map((person) => ({ kind: "person", id: `person-${person.id}`, person }));
  }
  return SEARCH_FLAGS.filter(({ key, value }) => key === modifier.key && value.startsWith(sought)).map(({ flag }) => ({ kind: "flag", id: `flag-${flag}`, flag }));
}

/**
 * The people besides you whose names have `sought`, in lower case, in them, by name: everyone the
 * directory lists, those who've been deactivated or suspended too, since what they wrote stays to be
 * found, but not anyone banned, whose messages went with them.
 */
function authorsMatching(people: Iterable<DirectoryUser>, meId: UserId, sought: string): DirectoryUser[] {
  return [...people]
    .filter((person) => person.id !== meId && person.status !== "banned" && person.name.toLowerCase().includes(sought))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
}

/** What the list offers otherwise: Show results for the search, once it can find anything, then the recent searches with the words typed. */
function suggestionsOf(searchable: boolean, typed: string, recent: Search[] | null): Option[] {
  const words = typed.trim().toLowerCase();
  const matching = (recent ?? []).filter((search) => words === "" || search.q.toLowerCase().includes(words));
  return [
    ...(searchable ? [{ kind: "search", id: "search" } as const] : []),
    ...matching.slice(0, words === "" ? undefined : RECENT_MATCHES).map((search, index) => ({ kind: "recent", id: `recent-${index}`, search }) as const),
  ];
}
