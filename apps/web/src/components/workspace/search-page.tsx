import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { sanitizeSearch, searchPath, type Me, type RoomId, type SearchResults } from "@ember/protocol";
import { ArrowLeft, ArrowUp, Search, Trash, Xmark } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { useNameOf } from "@/hooks/use-directory";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, pageMark, SEARCHES_PATH, useQueryParam, useVisit } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { clearSearches, fetchSearch, isSignedOut, recordSearch } from "@/lib/api";
import { toSentence } from "@/lib/directs";
import { pressedAlone } from "@/lib/keyboard";
import { cn } from "@/lib/utils";
import { ROUND_BUTTON } from "./link-buttons";
import { MessageItem, type MessageEditors } from "./message-item";
import { PageHeader } from "./page-header";

/** What ember-rust's broom asks before it clears your recent searches (searches/_recents.html). */
export const CONFIRM_CLEAR_SEARCHES = "Are you sure you want to clear your recent searches?";

/** Results can't be edited or replied to, so nothing opens an editor or writes in a composer. */
const NO_EDITORS: MessageEditors = { open() {}, close() {}, returnFocus() {}, attach() {}, reply() {} };

interface Props {
  me: Me;
  /** Where Exit search goes: the last room visited, as ember-rust's `return_to_room_id`, or home. */
  back: string;
  /** Says why a search failed, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * ember-rust's search page (searches/index.html), at `/searches?q=`: what was searched for and how many
 * messages it found in the top bar, your recent searches, then the messages it found, scrolled to the
 * newest, as messages that can't be changed, each naming its room, and the search field where the
 * composer would be. Searching records the search as your newest and goes to its address, and Escape
 * goes to `/searches`, as the field's × does. Each visit asks for its address's search afresh, as each
 * of ember-rust's pages is drawn, but the one a search goes to, which shows what the search answered.
 * Until a visit's search answers, the page, its field too, goes on showing the last one, marked busy, as
 * ember-rust's stays until Turbo draws the next, and drops it if the search fails. What the person types
 * in the field meanwhile stays there, where Turbo's next page would draw over it.
 */
export function SearchPage({ me, back, onFailed }: Props) {
  const q = useQueryParam("q");
  const visit = useVisit();
  // The page as last drawn: the visit and address's search it was drawn for, what that search found, or
  // null if it failed, and the visit its field was drawn afresh for.
  const [page, setPage] = useState<{ visit: number; q: string | null; results: SearchResults | null; field: number } | null>(null);
  // The visit the person last typed in the field during, before that visit's search had answered.
  const typedDuring = useRef<number | null>(null);
  // What the form's last search answered, and the visit it went on to, once that has shown it.
  const answered = useRef<{ query: string; results: SearchResults; visit?: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const list = useRef<HTMLElement>(null);
  const mounted = useMounted();
  const nameOf = useNameOf();
  useTitle("Search");

  useEffect(() => {
    // Draws what this visit's search found, and its field afresh, but for one the person has typed in since the visit began.
    const draw = (results: SearchResults | null) =>
      setPage((last) => ({ visit, q, results, field: typedDuring.current === visit ? (last?.field ?? visit) : visit }));
    const answer = answered.current;
    if (answer?.query === q && (answer.visit ?? visit) === visit) {
      answer.visit = visit;
      draw(answer.results);
      return;
    }
    answered.current = null;
    let stopped = false;
    fetchSearch(q).then(
      (found) => !stopped && draw(found),
      (error: unknown) => {
        if (stopped && !isSignedOut(error)) return;
        // What another search found doesn't stay at this one's address.
        if (!stopped) draw(null);
        onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [q, visit, onFailed]);
  const busy = page?.visit !== visit;
  const results = page?.results ?? null;
  // The field holds the search the page was drawn for, or the address's until it's drawn.
  const drawn = page ?? { q, field: visit };

  // As ember-rust's search_results_controller.js does, the newest message shows, at the bottom.
  useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [results]);

  // A DM is named after everyone in it, you too, as ember-rust names a result's room
  // (`room_display_name(message.room, for_user: nil)`, controllers/presenters.rs).
  const roomNames = useMemo(
    () => new Map<RoomId, string>(results?.rooms.map((room) => [room.id, room.kind === "direct" ? toSentence(room.members.map(nameOf)) : room.name])),
    [results, nameOf],
  );

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get("q"));
    const mark = pageMark();
    setSearching(true);
    recordSearch(typed)
      .then(
        (found) => {
          // A page the person has gone to meanwhile stays, as a visit stops ember-rust's form going on.
          if (!mounted.current || pageMark() !== mark) return;
          const query = sanitizeSearch(typed);
          answered.current = { query, results: found };
          navigate(searchPath(query));
        },
        (error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error),
      )
      .finally(() => mounted.current && setSearching(false));
  };

  // As ember-rust's broom does, asked first, then the page without a search.
  const clear = () => {
    if (!confirm(CONFIRM_CLEAR_SEARCHES)) return;
    const mark = pageMark();
    clearSearches().then(
      () => mounted.current && pageMark() === mark && navigate(SEARCHES_PATH),
      (error: unknown) => (mounted.current || isSignedOut(error)) && onFailed(error),
    );
  };

  // Escape follows the field's ×, as ember-rust's form_controller.js `cancel` clicks it.
  const cancel = (event: KeyboardEvent) => pressedAlone(event.nativeEvent, "Escape") && navigate(SEARCHES_PATH);

  const messages = results?.messages ?? [];
  return (
    <>
      <PageHeader>
        <h1 className="flex min-w-0 flex-1 items-center text-[17px] leading-[1.4] font-[650] max-md:text-base">Search messages</h1>
        {results?.query != null && <SearchedFor query={results.query} count={messages.length} />}
      </PageHeader>
      <MainContent
        aria-busy={busy || undefined}
        className="relative flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]"
      >
        {results && results.recent.length > 0 && <RecentSearches searches={results.recent} onClear={clear} />}
        {messages.length > 0 ? (
          // ember-rust's `.messages.searches__results` (zz-ember.css), which scrolls between the recent searches and the field.
          <section
            ref={list}
            aria-label="Search results"
            className="min-h-0 flex-1 basis-0 overflow-x-hidden overflow-y-auto overscroll-contain pt-5 pb-[18px] [scrollbar-gutter:stable] max-md:pt-[18px] max-md:pb-3"
          >
            {/* Each on its own, with no grouping or day separators, as search_results_controller.js formats them. */}
            {messages.map((message) => (
              <MessageItem key={message.id} message={message} me={me} threaded={false} editing={false} actions={null} editors={NO_EDITORS} roomName={roomNames.get(message.roomId)} />
            ))}
          </section>
        ) : results ? (
          <NoResults searched={results.query !== null} />
        ) : (
          <div className="flex-1" />
        )}

        {/* ember-rust's search footer (`.searches #footer` in zz-ember.css), clear of a phone's home indicator, as the composer is. */}
        <footer className="flex flex-none items-center gap-[1ch] border-t bg-background px-[22px] pt-3 pb-[max(12px,env(safe-area-inset-bottom))] max-md:gap-[5px] max-md:px-2.5 max-md:pt-2.5 max-md:pb-[max(10px,env(safe-area-inset-bottom))]">
          <PageLink href={back} className="grid size-9 shrink-0 place-items-center rounded-[0.5em] border bg-background touch:size-11">
            <ArrowLeft className="size-[1.3em]" />
            <span className="sr-only">Exit search</span>
          </PageLink>
          <form onSubmit={search} onKeyDown={cancel} aria-busy={searching || undefined} className="flex min-w-0 flex-1 items-center [contain:inline-size]">
            {/* Campfire's `.input--actor`: the field's border holds the hint, the field, its × and the button. */}
            <div className="flex min-h-11 w-full min-w-0 items-center gap-[1ch] rounded-[9px] border px-[0.8em] py-[0.5em] text-base focus-within:border-muted-foreground max-md:px-2">
              <Search className="size-5 shrink-0 max-md:hidden" />
              {/* Afresh with each search drawn, holding it, and focused, as ember-rust's `autofocus` field is on each page drawn,
                  but for one typed in while it loaded. It takes taps from the top of its box to the bottom, which ember-rust's
                  leaves to the box around it. */}
              <input
                key={drawn.field}
                name="q"
                type="text"
                role="searchbox"
                aria-label="search"
                placeholder="Search messages…"
                required
                autoFocus
                defaultValue={drawn.q ?? ""}
                onChange={() => {
                  if (busy) typedDuring.current = visit;
                }}
                className="peer -my-[0.5em] min-w-0 flex-1 self-stretch bg-transparent py-[0.5em] placeholder:text-muted-foreground focus-visible:outline-none"
              />
              {/* Hidden while the field is empty, as Campfire's `.searches__input:required:invalid ~ .searches__reset` is,
                  and 44px for fingers, as the button beside it is, where ember-rust's is only its 14px icon. */}
              <PageLink href={SEARCHES_PATH} role="button" className="grid shrink-0 place-items-center peer-invalid:hidden touch:-my-[0.4em] touch:size-11">
                <Xmark className="size-5" />
                <span className="sr-only">Clear search field</span>
              </PageLink>
              <button
                type="submit"
                disabled={searching}
                className={cn(
                  "-my-[0.4em] -mr-[0.7em] grid size-9 shrink-0 cursor-pointer place-items-center rounded-[0.5em] bg-foreground text-[0.8rem] text-background hover:not-active:brightness-70 touch:size-11",
                  "disabled:pointer-events-none disabled:opacity-50 disabled:grayscale disabled:contrast-50",
                )}
              >
                <ArrowUp className="size-[1.3em]" />
                <span className="sr-only">Search</span>
              </button>
            </div>
          </form>
        </footer>
      </MainContent>
    </>
  );
}

/**
 * ember-rust's `.searches__query` (searches/index.html): the search, in quotes and cut short first, and
 * how many messages it found, at most 40% of the top bar. It's a `.btn--reversed` there, but the top bar
 * clears every `.btn` in it (zz-ember.css, `#nav .btn`), so it shows as plain text.
 */
function SearchedFor({ query, count }: { query: string; count: number }) {
  return (
    <div className="flex max-w-[40%] min-w-0 items-center gap-[1ch] rounded-lg border border-transparent px-[1.1em] py-[0.5em] font-medium whitespace-nowrap">
      <span className="truncate">“{query}”</span>
      <span className="shrink-0">{count}</span>
    </div>
  );
}

/**
 * ember-rust's recent searches (searches/_recents.html; `.mb-search-recents` in zz-ember.css, over
 * Campfire's `.searches__recents` in sidebar.css): a row of your recent searches, newest first, each at
 * most 20 characters wide and spread across the row, that scrolls sideways under a fading left edge, then
 * the trash can, which clears them.
 */
function RecentSearches({ searches, onClear }: { searches: string[]; onClear: () => void }) {
  return (
    <div
      role="group"
      aria-label="Recent searches"
      className="flex flex-none items-center gap-[1ch] overflow-x-auto px-4 py-2 [mask-image:linear-gradient(to_left,#000_97%,transparent_99%)]"
    >
      {searches.map((search) => (
        <PageLink
          key={search}
          href={searchPath(search)}
          className="mr-auto inline-flex max-w-[20ch] items-center rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium whitespace-nowrap first:ml-[1ch] touch:min-h-11"
        >
          <span className="truncate">“{search}”</span>
        </PageLink>
      ))}
      <button type="button" onClick={onClear} className={cn(ROUND_BUTTON, "mr-[2ch]")}>
        <Trash className="size-[1.3em]" />
        <span className="sr-only">Clear recent searches</span>
      </button>
    </div>
  );
}

/**
 * ember-rust's `.message-area--empty` (searches/index.html, zz-ember.css), centred where the results would
 * be: a magnifying glass, faded, over what to do, which tells a search that found nothing from no search
 * at all.
 */
function NoResults({ searched }: { searched: boolean }) {
  return (
    <div className="grid min-h-0 flex-1 content-center justify-items-center">
      <div className="min-w-0 p-6 text-center text-muted-foreground">
        <figure className="px-[1ch] py-4">
          <Search className="mx-auto h-auto w-16 max-w-[25vw] text-foreground opacity-20" />
        </figure>
        <h2 className="mb-1.5 text-xl font-bold text-foreground">{searched ? "No messages found" : "Find a conversation"}</h2>
        <p>{searched ? "Try a different word or phrase." : "Search messages across your rooms and direct messages."}</p>
      </div>
    </div>
  );
}
