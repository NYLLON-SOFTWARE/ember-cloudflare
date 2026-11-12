import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  isWebImage,
  MAX_NOTE_FILES,
  savedPath,
  workspacePageOf,
  type Me,
  type Message,
  type NoteFile,
  type Room,
  type RoomId,
  type UserId,
  type SavedItem,
  type SavedList,
  type StoredFile,
} from "@ember/protocol";
import { ArrowLeft, Bookmark, CheckCircle, CheckCircleSolid, Clock, Edit, MoreHoriz, NavArrowDown, NavArrowRight, Page, Plus, Xmark } from "@/components/icons/iconoir";
import { Sort } from "@/components/icons/iconoir-more";
import { fileTypeOf } from "@ember/protocol/library";
import { Lightbox } from "@/components/lightbox";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNameOf } from "@/hooks/use-directory";
import { usePhoneLayout } from "@/hooks/use-phone-layout";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, permalinkOf, returnTo } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { isSignedOut } from "@/lib/api";
import { dateOf, FILTER_LABELS, shortDateLabel, FILTERS, localInputValue, originOf, reminderChoices, shows, sorted, SORT_LABELS, SORTS, summaryOf, type KeptFilter, type KeptSort } from "@/lib/kept";
import { dateTimeLabel } from "@/lib/messages";
import { clearItem, keepItem, useSavedVersion } from "@/lib/saved";
import { changeItem, fetchSavedItem, fetchSavedList, uploadNoteFile } from "@/lib/saved-lists";
import { cn } from "@/lib/utils";
import { Attachment } from "./attachment";
import { ATTACH_BUTTON } from "./composer-buttons";
import { EmojiButton, FormattingToggle, MentionButton } from "./composer-menus";
import { ComposerToolbar } from "./composer-toolbar";
import { NO_FORMATS, PHONE_TOOL_GROUPS, type Formats } from "./formatting";
import { FileTypeIcon, PILL } from "./file-list";
import { Chip, CHIPS_ROW } from "./search-box";
import { RichTextEditor, type RichTextEditorHandle } from "./editor";
import { MessageItem, type MessageEditors } from "./message-item";
import { HEADER_TEXT_BUTTON, PageHeader } from "./page-header";
import type { RoomPanes } from "./room-view";
import { SplitPanes, type Pane, type PaneStack } from "./split-panes";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ROUND_BUTTON } from "../mobile/back-button";
import { UserAvatar } from "./user-avatar";

// To-dos and Saved, after Slack's: a list of what you keep, filtered and sorted, beside the item you've
// opened. To-dos splits its list into In progress and Completed and holds notes of your own; Saved is
// one list. Each row's actions show as the pointer reaches it, or behind its ⋯ for fingers.

/** A kept message can't be edited or replied to here, so nothing opens an editor or writes in a composer. */
const NO_EDITORS: MessageEditors = { open() {}, close() {}, returnFocus() {}, attach() {}, reply() {} };

/** What each list calls itself, and one of its items. */
const NAMES = {
  todo: { title: "To-dos", item: "To-do", empty: "No to-dos" },
  saved: { title: "Saved", item: "Saved item", empty: "Nothing saved" },
} as const satisfies Record<SavedList, Record<string, string>>;

const TOOLBAR_BUTTON =
  "inline-flex min-h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover touch:min-h-11 touch:min-w-11 aria-expanded:bg-hover";

const ROW_ACTION =
  "grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground [&_svg]:size-4";

/** Where a saved message opens: its room, around it, or around its thread's message with the thread open at it. */
export interface KeptPlace {
  roomId: RoomId;
  messageId: string;
  threadId?: string;
  replyId?: string;
}

interface Props {
  list: SavedList;
  itemId?: string;
  me: Me;
  rooms: Room[];
  onFailed: (error: unknown) => void;
  /** The room `place` names, shown in the detail pane, its thread put in another by `panes`. */
  renderRoom?: (place: KeptPlace, panes: RoomPanes) => ReactNode;
  /** Called with which panes are open, and what closes the deepest, for a phone's back stack. */
  onPaneStack?: (stack: PaneStack) => void;
}

/**
 * Where `message` opens: around it, or for a reply, around its thread's message with the thread open at
 * the reply, or with `thread` open, a thread opened from the conversation since.
 */
function placeOfMessage(message: Message, thread: OpenThread | "closed" | null): KeptPlace {
  const around = { roomId: message.roomId, messageId: message.parentId ?? message.id };
  if (thread === "closed") return around;
  if (thread) return { ...around, ...thread };
  return message.parentId === undefined ? around : { ...around, threadId: message.parentId, replyId: message.id };
}

/** A thread open beside a saved message's conversation, at a reply or not. */
interface OpenThread {
  threadId: string;
  replyId?: string;
}

/** Opens a thread of the conversation shown in the pane beside it, as Activity does, rather than going to the room's page. */
function openThreadForLink(event: MouseEvent, place: KeptPlace, open: (thread: OpenThread) => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.origin !== location.origin) return;
  const target = workspacePageOf(link.pathname);
  if (target?.page !== "room" || target.roomId !== place.roomId || target.threadId === undefined) return;
  event.preventDefault();
  open({ threadId: target.threadId, ...(target.replyId !== undefined && { replyId: target.replyId }) });
}

/** Your to-dos, at `/todos`. */
export function TodosPage(props: Omit<Props, "list">) {
  return <KeptPage list="todo" {...props} />;
}

/** A phone's Back from the list, to Home, which opened it: back, when Home was the entry before, so the two don't loop. */
function backHome(event: MouseEvent<HTMLAnchorElement>) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  returnTo("/");
}

/** Where a new to-do's unsaved text is kept in this browser, or a note's being changed, by `userId`. */
const draftKeyOf = (userId: UserId, itemId?: string) => `todo-draft-${userId}${itemId === undefined ? "" : `-${itemId}`}`;

/** The draft kept at `key`, or null with none, or where storage can't be reached. */
function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Keeps `html` as the draft at `key`, or forgets it for null. */
function keepDraft(key: string, html: string | null): void {
  try {
    if (html) localStorage.setItem(key, html);
    else localStorage.removeItem(key);
  } catch {
    // Unkept, then.
  }
}

/** Moves the draft at `from` to `to`, saying whether there was one. */
function moveDraft(from: string, to: string): boolean {
  const html = readDraft(from);
  if (!html) return false;
  keepDraft(to, html);
  keepDraft(from, null);
  return true;
}

/** The keys typed while an editor opens, which it takes once it has focus. */
interface TypedAhead {
  take: () => string;
}

/**
 * Keeps what's typed from now until the editor opening takes it, as Edit's does a moment after it's
 * pressed, so the first keys aren't lost. It gives up after a few seconds.
 */
function typeAhead(): TypedAhead {
  let text = "";
  const keep = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1) text += event.key;
    else if (event.key === "Backspace") text = text.slice(0, -1);
    else return;
    event.preventDefault();
  };
  const stop = () => {
    document.removeEventListener("keydown", keep, true);
    clearTimeout(timer);
  };
  document.addEventListener("keydown", keep, true);
  const timer = setTimeout(stop, 3000);
  return {
    take: () => {
      stop();
      const typed = text;
      text = "";
      return typed;
    },
  };
}

/** What you've saved, at `/saved`. */
export function SavedPage(props: Omit<Props, "list">) {
  return <KeptPage list="saved" {...props} />;
}

function KeptPage({ list, itemId, me, rooms, onFailed, renderRoom, onPaneStack }: Props) {
  const names = NAMES[list];
  useTitle(names.title);
  const mounted = useMounted();
  const version = useSavedVersion();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [filter, setFilter] = useState<KeptFilter>("all");
  const [sort, setSort] = useState<KeptSort>("newest");
  const [creating, setCreating] = useState(false);
  // The note Edit opened, whose text takes focus and the keys typed before it could.
  const [editing, setEditing] = useState<{ id: string; typed: TypedAhead } | null>(null);
  const [viewing, setViewing] = useState<StoredFile | null>(null);
  // A thread opened from a saved message's conversation, in the pane beside it, and that pane.
  // A saved reply opens with its thread, until that's closed.
  const [thread, setThread] = useState<OpenThread | "closed" | null>(null);
  const [threadPane, setThreadPane] = useState<HTMLElement | null>(null);
  // How many of the panes the row is too narrow for, which hides the list.
  const [hiddenPanes, setHiddenPanes] = useState(0);
  // Another item opens with no thread of its own open.
  const [threadFor, setThreadFor] = useState(itemId);
  if (threadFor !== itemId) {
    setThreadFor(itemId);
    setThread(null);
  }

  // Loads again whenever what you keep changes, here or in another tab, so a moved item leaves this list,
  // and whenever your rooms do, so an item from a room you've left shows as unavailable at once.
  const roomIds = rooms.map((room) => room.id).join(" ");
  useEffect(() => {
    let current = true;
    fetchSavedList(list).then(
      (loaded) => current && setItems(loaded),
      (error: unknown) => current && onFailed(error),
    );
    return () => {
      current = false;
    };
  }, [list, version, roomIds, onFailed]);

  // An item's address in the other list, as a link from before it moved, goes on to its own.
  const missing = itemId !== undefined && items !== null && !items.some((item) => item.id === itemId);
  useEffect(() => {
    if (!missing || itemId === undefined) return;
    let current = true;
    fetchSavedItem(itemId).then(
      (item) => current && item.list !== list && navigate(savedPath(item.list, item.id), { replace: true }),
      () => {
        // Cleared elsewhere while you changed it: what you'd written opens again as a new to-do.
        if (!current || !moveDraft(draftKeyOf(me.id, itemId), draftKeyOf(me.id))) return;
        setCreating(true);
        returnTo(savedPath(list));
      },
    );
    return () => {
      current = false;
    };
  }, [missing, itemId, list, me.id]);

  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const shown = useMemo(() => (items ? sorted(items.filter((item) => shows(filter, item)), sort) : []), [items, filter, sort]);
  const selected = itemId === undefined ? null : (items?.find((item) => item.id === itemId) ?? null);

  const failed = (error: unknown) => mounted.current && onFailed(error);
  /** Takes `item` as it is now, in this list or out of it. */
  const replaced = (item: SavedItem) => setItems((items) => items && (item.list === list ? items.map((i) => (i.id === item.id ? item : i)) : items.filter((i) => i.id !== item.id)));
  const act = (work: Promise<SavedItem>) => work.then(replaced, failed);
  const actions: RowActions = {
    complete: (item) => act(changeItem(item.id, { completed: item.completedAt === null })),
    move: (item) => act(changeItem(item.id, { list: list === "todo" ? "saved" : "todo" })),
    remind: (item, at) => act(changeItem(item.id, { remindAt: at && at.toISOString() })),
    clear: (item) => {
      keepDraft(draftKeyOf(me.id, item.id), null);
      setItems((items) => items && items.filter((i) => i.id !== item.id));
      if (item.id === itemId) returnTo(savedPath(list));
      clearItem(item.id).catch(failed);
    },
    open: (item) => {
      setCreating(false);
      const file = item.message?.attachment;
      // A saved file does what its type does: a picture opens in the viewer, and anything else opens.
      if (list === "saved" && file) {
        if (isWebImage(file.contentType)) setViewing(file);
        else window.open(file.url, "_blank", "noopener");
        return;
      }
      navigate(savedPath(list, item.id));
    },
    edit: (item) => {
      // A note opens with the cursor in its text, ready to change it.
      if (item.kind === "note") setEditing({ id: item.id, typed: typeAhead() });
      actions.open(item);
    },
  };

  const startNew = () => {
    setCreating(true);
    if (itemId !== undefined) navigate(savedPath(list));
  };
  const created = (item: SavedItem) => {
    setItems((items) => items && [item, ...items.filter((i) => i.id !== item.id)]);
    setCreating(false);
    // The new to-do takes the place of the blank one, so Back from it goes to the list.
    navigate(savedPath(list, item.id), { replace: true });
  };
  const closeDetail = () => {
    setCreating(false);
    if (itemId !== undefined) returnTo(savedPath(list));
  };
  // An item open at its own address is already an entry in the history, so a phone's Back leaves it
  // without one for its pane too; a new to-do, and a thread beside a saved message, get one.
  const paneStack = useCallback(
    (stack: PaneStack) => onPaneStack?.(itemId === undefined ? stack : { ...stack, open: stack.open.filter((id) => id !== "detail") }),
    [onPaneStack, itemId],
  );
  const detailOpen = creating || itemId !== undefined;

  const row = (item: SavedItem) => (
    <KeptRow key={item.id} item={item} list={list} selected={item.id === itemId} origin={originOf(item, roomsById, me.id, nameOf)} actions={actions} />
  );
  const nameOf = useNameOf();
  const inProgress = shown.filter((item) => item.completedAt === null);
  const completed = shown.filter((item) => item.completedAt !== null);

  const phone = usePhoneLayout();
  const header = (
    <>
      <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-center max-md:font-bold">{names.title}</h1>
      {list === "todo" ? (
        <button type="button" aria-label="Add To-do" className={cn(HEADER_TEXT_BUTTON, "border-border max-md:size-11 max-md:rounded-full max-md:p-0")} onClick={startNew}>
          {phone ? <Plus className="size-[22px]" /> : <CheckCircle className="size-4" />}
          {!phone && "Add To-do"}
        </button>
      ) : (
        // Balances Back, so the title sits in the middle of a phone's bar.
        phone && <span aria-hidden="true" className="w-11 shrink-0" />
      )}
    </>
  );
  const listPane = (
    <section aria-label={names.title} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {/* On phones the page's own top bar, with Back, stands over the list instead. */}
      {!phone && <div className="flex min-h-header items-center gap-3 border-b px-4 py-2.5">{header}</div>}
      {items !== null && items.length > 0 && (
        <div className="flex items-center gap-2 border-b py-2 pr-4 md:pl-4">
          <div role="group" aria-label="Filter" className={cn("flex min-w-0 flex-1 gap-2", CHIPS_ROW)}>
            {FILTERS[list].map((option) => (
              <Chip key={option} pressed={filter === option} onClick={() => setFilter(option)}>
                {FILTER_LABELS[option]}
              </Chip>
            ))}
          </div>
          <SortMenu list={list} sort={sort} onSort={setSort} />
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items === null ? (
          <p className="p-6 text-center text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <div className="grid h-full place-content-center justify-items-center gap-3 p-6 text-muted-foreground">
            {list === "todo" ? <CheckCircle className="size-12" strokeWidth={1.25} /> : <Bookmark className="size-12" strokeWidth={1.25} />}
            <p>{names.empty}</p>
          </div>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">Nothing matches</p>
        ) : list === "todo" ? (
          <>
            <Section title="In progress" count={inProgress.length}>
              {inProgress.map(row)}
            </Section>
            <Section title="Completed" count={completed.length}>
              {completed.map(row)}
            </Section>
          </>
        ) : (
          <ul>{shown.map(row)}</ul>
        )}
      </div>
    </section>
  );

  // A saved message opens where it is, in its conversation, as Slack's do; anything else opens its details.
  const place = list === "saved" && selected?.message && renderRoom ? placeOfMessage(selected.message, thread) : null;
  const detail = creating ? (
    <Detail title={names.item} onClose={closeDetail}>
      <NoteEditor key="new" draftKey={draftKeyOf(me.id)} onSaved={created} onFailed={failed} />
    </Detail>
  ) : place && renderRoom ? (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" onClickCapture={(event) => openThreadForLink(event, place, setThread)}>
      {/* Where the list doesn't show beside it, as on a phone, a way back to it. */}
      {/* Phones' back stack is the mobile layout's (`onPaneStack`), as Activity's is. */}
      {hiddenPanes > 0 && !phone && (
        <button type="button" onClick={closeDetail} className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 pt-[env(safe-area-inset-top)] text-sm font-semibold hover:bg-hover">
          <ArrowLeft className="size-[18px]" />
          {names.title}
        </button>
      )}
      {/* The room's panes grid sizes its one column to the header's text, wider than a phone, unless held to the pane. */}
      <div className="min-h-0 min-w-0 flex-1 *:grid-cols-[minmax(0,1fr)]">{renderRoom(place, { thread: threadPane, onCloseThread: () => setThread("closed") })}</div>
    </div>
  ) : selected ? (
    <Detail title={names.item} onClose={closeDetail} menu={<ItemMenu item={selected} list={list} actions={actions} className={ROUND_BUTTON} />}>
      <ItemDetail key={selected.id} item={selected} typed={editing?.id === selected.id ? editing.typed : null} me={me} origin={originOf(selected, roomsById, me.id, nameOf)} actions={actions} onChanged={replaced} onFailed={failed} />
    </Detail>
  ) : itemId !== undefined && items !== null ? (
    <Detail title={names.item} onClose={closeDetail}>
      <p className="text-muted-foreground">That item isn’t in your {names.title.toLowerCase()}.</p>
    </Detail>
  ) : null;

  const panes: Pane[] = [
    { id: "list", label: `Resize ${names.title}`, minWidth: 320, defaultShare: 0.36, content: listPane },
    { id: "detail", label: `Resize ${names.title}`, minWidth: 360, defaultShare: 0.64, onClose: detailOpen ? closeDetail : undefined, content: detail },
  ];
  // With nothing open, the list has the page to itself.
  if (!detail) panes.pop();
  if (place?.threadId !== undefined)
    panes.push({ id: "thread", label: "Resize thread", minWidth: 300, defaultShare: 0.3, onClose: () => setThread("closed"), content: <div ref={setThreadPane} className="h-full min-h-0" /> });

  return (
    <>
      {phone && !detailOpen && (
        <PageHeader>
          <a href="/" aria-label="Back" title="Back" onClick={backHome} className={ROUND_BUTTON}>
            <ArrowLeft className="size-[22px]" />
          </a>
          {header}
        </PageHeader>
      )}
      <SplitPanes
        layoutKey={list === "todo" ? "todos" : "saved"}
        panes={panes}
        onLayout={onPaneStack && paneStack}
        onCollapsed={setHiddenPanes}
        className={cn(
          "row-span-2 row-start-1 bg-background max-md:col-start-1",
          // To-dos takes the conversations' place, as Activity does; Saved stays beside them, under Home.
          list === "todo" ? "col-start-2 col-end-[-1]" : "col-start-3 col-end-[-1]",
          !detailOpen && "max-md:row-span-1 max-md:row-start-2",
        )}
      />
      {viewing && <Lightbox src={viewing.url} downloadUrl={viewing.downloadUrl} filename={viewing.name} alt={viewing.name} onClose={() => setViewing(null)} />}
    </>
  );
}

/** A collapsible part of To-dos: In progress or Completed, with how many it holds. */
function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="border-b last:border-b-0">
      <h2>
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-1.5 px-4 py-2.5 text-left text-sm font-semibold hover:bg-hover touch:min-h-11">
          {open ? <NavArrowDown className="size-4" /> : <NavArrowRight className="size-4" />}
          {title}
          <span className="font-normal text-muted-foreground">{count}</span>
        </button>
      </h2>
      {open && <ul>{children}</ul>}
    </section>
  );
}

function SortMenu({ list, sort, onSort }: { list: SavedList; sort: KeptSort; onSort: (sort: KeptSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Sort: ${SORT_LABELS[sort]}`} className={PILL}>
        <Sort className="size-4" />
        <span className="max-md:sr-only">{SORT_LABELS[sort]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSort(value as KeptSort)}>
          {SORTS[list].map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {SORT_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a row's actions do. */
interface RowActions {
  complete: (item: SavedItem) => void;
  move: (item: SavedItem) => void;
  remind: (item: SavedItem, at: Date | null) => void;
  clear: (item: SavedItem) => void;
  open: (item: SavedItem) => void;
  /** Opens it to change it: a note with the cursor in its text. */
  edit: (item: SavedItem) => void;
}

/** A kept file's tile, as Files shows one: a picture's or video's thumbnail, or else its type's icon. */
function FileTile({ file }: { file: StoredFile }) {
  const thumbnail = file.previewUrl ?? (isWebImage(file.contentType) ? file.url : undefined);
  return thumbnail ? (
    <img src={thumbnail} alt="" loading="lazy" className="size-9 shrink-0 rounded-lg bg-hover object-cover" />
  ) : (
    <FileTypeIcon file={{ kind: "file", type: fileTypeOf(file.contentType, file.name) }} />
  );
}

function KeptRow({ item, list, selected, origin, actions }: { item: SavedItem; list: SavedList; selected: boolean; origin: string; actions: RowActions }) {
  const date = dateOf(item);
  const file = item.message?.attachment;
  const gone = item.kind !== "note" && !item.message;
  const done = item.completedAt !== null;
  const overdue = item.remindAt !== null && item.reminded === true && !done;
  const nameOf = useNameOf();
  return (
    <li className={cn("group/row relative flex items-start gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-hover", selected && "bg-hover")}>
      {gone ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
          <Page className="size-5" />
        </span>
      ) : file ? (
        <FileTile file={file} />
      ) : item.message ? (
        <UserAvatar user={item.message.creator} square className="size-9 shrink-0" />
      ) : (
        // A note of your own needs no face of yours on every row.
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-foreground">
          <Page className="size-5" />
        </span>
      )}
      <button
        type="button"
        onClick={() => actions.open(item)}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-foreground"
      >
        <span className={cn("block truncate text-[15px] max-md:text-[17px]", gone && "text-muted-foreground italic", done && "text-muted-foreground line-through")}>
          {done && <span className="sr-only">Completed: </span>}
          {summaryOf(item)}
        </span>
        {/* An overdue to-do says so first, in place of its date; an upcoming reminder's time stays in sight. */}
        <span className="flex min-w-0 gap-1 text-[13px] text-muted-foreground max-md:text-[15px]">
          <span className="truncate">
            {overdue && <span className="text-negative">Overdue · </span>}
            {item.message && <>{nameOf(item.message.creator)} · </>}
            {origin && <>{origin}{!overdue && " · "}</>}
            {!overdue && (
              <time dateTime={date} title={dateTimeLabel(new Date(date))}>
                {shortDateLabel(new Date(date))}
              </time>
            )}
          </span>
          {item.remindAt && !done && !overdue && (
            <span className="shrink-0">
              {"· "}
              <Clock className="inline size-3.5 align-[-2px]" /> {dateTimeLabel(new Date(item.remindAt))}
            </span>
          )}
        </span>
      </button>
      <RowActionBar item={item} list={list} actions={actions} />
    </li>
  );
}

/**
 * A row's actions: To-dos' Mark completed, Edit, Add reminder, Move to Saved and Clear, and Saved's Move to
 * To-dos and Clear. With a mouse they show over the row's right end as the pointer reaches it; for fingers,
 * they're in the menu its ⋯ opens.
 */
function RowActionBar({ item, list, actions }: { item: SavedItem; list: SavedList; actions: RowActions }) {
  const done = item.completedAt !== null;
  const moveLabel = list === "todo" ? "Move to Saved" : "Move to To-dos";
  const clearLabel = CLEAR_LABELS[list];
  return (
    <>
      {/* It stays while its menu's open, and fades the title it covers. */}
      <div className="absolute top-1/2 right-3 z-1 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border bg-background p-0.5 shadow-sm group-focus-within/row:flex group-hover/row:flex has-[[aria-expanded=true]]:flex before:pointer-events-none before:absolute before:inset-y-0 before:right-full before:w-10 before:bg-linear-to-l before:from-hover before:to-transparent touch:hidden!">
        {list === "todo" && (
          <button type="button" title={done ? "Mark in progress" : "Mark completed"} aria-label={done ? "Mark in progress" : "Mark completed"} className={ROW_ACTION} onClick={() => actions.complete(item)}>
            {done ? <CheckCircleSolid /> : <CheckCircle />}
          </button>
        )}
        {list === "todo" && (
          <button type="button" title="Edit" aria-label="Edit" className={ROW_ACTION} onClick={() => actions.edit(item)}>
            <Edit />
          </button>
        )}
        {list === "todo" && (
          <ReminderMenu item={item} onRemind={(at) => actions.remind(item, at)}>
            <DropdownMenuTrigger title="Add reminder" aria-label="Add reminder" className={ROW_ACTION}>
              <Clock />
            </DropdownMenuTrigger>
          </ReminderMenu>
        )}
        <button type="button" title={moveLabel} aria-label={moveLabel} className={ROW_ACTION} onClick={() => actions.move(item)}>
          {list === "todo" ? <Bookmark /> : <CheckCircle />}
        </button>
        <button type="button" title={clearLabel} aria-label={clearLabel} className={ROW_ACTION} onClick={() => actions.clear(item)}>
          <Xmark />
        </button>
      </div>
      <ItemMenu item={item} list={list} actions={actions} className="relative z-1 hidden self-center touch:grid" />
    </>
  );
}

/** What takes an item out of its list: a to-do's done with, and a saved item's no longer saved. */
const CLEAR_LABELS = { todo: "Clear", saved: "Remove from saved" } as const satisfies Record<SavedList, string>;

/** One of the item sheet's rows: full width, a fingertip's 48px tall at least. */
const SHEET_ROW = "flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-start text-base hover:bg-hover active:bg-hover";

/**
 * ⋯ for fingers, on a row and over an open to-do, which opens the item's actions in a sheet from the
 * bottom of the screen: To-dos' Mark completed, Edit, Move to Saved and Remind me…, whose times take the
 * sheet's place, and Saved's Move to To-dos, with Clear or Remove from saved set apart below.
 */
function ItemMenu({ item, list, actions, className }: { item: SavedItem; list: SavedList; actions: RowActions; className?: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"actions" | "remind" | "custom">("actions");
  const done = item.completedAt !== null;
  const opened = (open: boolean) => {
    setOpen(open);
    if (!open) setView("actions");
  };
  const row = (label: string, onSelect: () => void, { keepOpen = false, destructive = false, detail }: { keepOpen?: boolean; destructive?: boolean; detail?: string } = {}) => (
    <button
      key={label}
      type="button"
      onClick={() => {
        if (!keepOpen) opened(false);
        onSelect();
      }}
      className={cn(SHEET_ROW, destructive && "text-destructive")}
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{label}</span>
        {detail && <span className="truncate text-sm text-muted-foreground">{detail}</span>}
      </span>
    </button>
  );
  const remind = (at: Date | null) => actions.remind(item, at);
  return (
    <>
      <button type="button" aria-label="Item actions" aria-haspopup="dialog" aria-expanded={open} onClick={() => opened(true)} className={cn(ROW_ACTION, "size-11 shrink-0", className)}>
        <MoreHoriz />
      </button>
      <Sheet open={open} onOpenChange={opened}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="mx-auto max-w-[560px] gap-1 rounded-t-[20px] border-x px-2 pt-2 pr-[max(8px,env(safe-area-inset-right))] pb-[max(12px,env(safe-area-inset-bottom))] pl-[max(8px,env(safe-area-inset-left))]"
        >
          <span aria-hidden="true" className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/40" />
          <SheetTitle className="truncate px-4 pt-1 pb-2 text-[15px] font-semibold text-muted-foreground">{view === "actions" ? summaryOf(item) : "Remind me"}</SheetTitle>
          <SheetDescription className="sr-only">{view === "actions" ? `Actions for ${summaryOf(item)}` : "When to remind you"}</SheetDescription>
          {view === "actions" ? (
            <>
              {list === "todo" && row(done ? "Mark in progress" : "Mark completed", () => actions.complete(item))}
              {list === "todo" && row("Edit", () => actions.edit(item))}
              {row(list === "todo" ? "Move to Saved" : "Move to To-dos", () => actions.move(item))}
              {list === "todo" && row("Remind me…", () => setView("remind"), { keepOpen: true, detail: item.remindAt ? dateTimeLabel(new Date(item.remindAt)) : undefined })}
              <hr className="mx-4 my-1 border-t" />
              {row(CLEAR_LABELS[list], () => actions.clear(item), { destructive: true })}
            </>
          ) : view === "remind" ? (
            <>
              {reminderChoices(new Date()).map(({ label, at }) => row(label, () => remind(at)))}
              {row("Custom…", () => setView("custom"), { keepOpen: true })}
              {item.remindAt && (
                <>
                  <hr className="mx-4 my-1 border-t" />
                  {row("Remove reminder", () => remind(null))}
                </>
              )}
            </>
          ) : (
            <CustomReminder
              large
              onRemind={(at) => {
                opened(false);
                remind(at);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Add reminder's menu, around its trigger: the times it offers, a time of your own, and Remove reminder once one is set. */
function ReminderMenu({ item, onRemind, children }: { item: SavedItem; onRemind: (at: Date | null) => void; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const opened = (open: boolean) => {
    setOpen(open);
    if (!open) setCustom(false);
  };
  return (
    <DropdownMenu open={open} onOpenChange={opened}>
      {children}
      <DropdownMenuContent align="end" className="min-w-56">
        {custom ? (
          <CustomReminder
            onRemind={(at) => {
              opened(false);
              onRemind(at);
            }}
          />
        ) : (
          <>
            {reminderChoices(new Date()).map(({ label, at }) => (
              <DropdownMenuItem key={label} onSelect={() => onRemind(at)}>
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setCustom(true);
              }}
            >
              Custom…
            </DropdownMenuItem>
            {item.remindAt && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onRemind(null)}>Remove reminder</DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A time of your own for a reminder, in a menu, for Custom…. */
function CustomReminder({ onRemind, large = false }: { onRemind: (at: Date) => void; large?: boolean }) {
  return (
    <form
      className={cn("grid gap-2 p-2", large && "gap-3 px-4 pb-2")}
      onSubmit={(event) => {
        event.preventDefault();
        const value = new FormData(event.currentTarget).get("at");
        if (typeof value === "string" && value) onRemind(new Date(value));
      }}
    >
      <label className="grid gap-1 text-[13px]">
        {/* The sheet's title already says it. */}
        <span className={cn(large && "sr-only")}>Remind me at</span>
        <input
          name="at"
          type="datetime-local"
          required
          defaultValue={localInputValue(new Date(Date.now() + 3_600_000))}
          className={cn("rounded-md border bg-background px-2 py-1 text-base", large && "h-11 rounded-xl px-3")}
        />
      </label>
      <button type="submit" className={cn("rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background", large && "h-11 rounded-xl bg-primary text-base text-primary-foreground")}>
        Set reminder
      </button>
    </form>
  );
}

/** The pane beside the list: its title and ×, over what's open, or on a phone, where it covers the list, Back and its title. */
function Detail({ title, onClose, menu, children }: { title: string; onClose: () => void; menu?: ReactNode; children: ReactNode }) {
  const phone = usePhoneLayout();
  return (
    <MainContent className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <div className="flex min-h-header items-center gap-2 border-b px-5 max-md:min-h-14 max-md:px-2 max-md:pt-[env(safe-area-inset-top)]">
        {phone && (
          <button type="button" aria-label="Back" title="Back" onClick={onClose} className={ROUND_BUTTON}>
            <ArrowLeft className="size-[22px]" />
          </button>
        )}
        <h2 className="flex-1 text-[17px] font-[650] max-md:text-center">{title}</h2>
        {phone ? (
          (menu ?? <span aria-hidden="true" className="w-11 shrink-0" />)
        ) : (
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 cursor-pointer place-items-center rounded-lg hover:bg-hover touch:size-11">
            <Xmark className="size-5" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
    </MainContent>
  );
}

interface ItemDetailProps {
  item: SavedItem;
  /** What was typed after Edit opened a note, which takes focus, or null when it doesn't. */
  typed: TypedAhead | null;
  me: Me;
  origin: string;
  actions: RowActions;
  onChanged: (item: SavedItem) => void;
  onFailed: (error: unknown) => void;
}

/** An item opened beside its list: a note to edit, or the message it keeps, with its reminder and status. */
function ItemDetail({ item, typed, me, origin, actions, onChanged, onFailed }: ItemDetailProps) {
  return (
    <div className="grid gap-4">
      {item.kind === "note" ? (
        <NoteEditor item={item} draftKey={draftKeyOf(me.id, item.id)} typed={typed} onSaved={onChanged} onFailed={onFailed} />
      ) : item.unavailable ? (
        <p className="text-muted-foreground">This message is unavailable.</p>
      ) : !item.message ? (
        <p className="text-muted-foreground italic">This message was deleted.</p>
      ) : (
        <div className="grid gap-2">
          {origin && <p className="text-[13px] text-muted-foreground">{origin}</p>}
          <div role="log" className="overflow-hidden rounded-xl border">
            <MessageItem message={item.message} me={me} threaded={false} editing={false} actions={null} editors={NO_EDITORS} />
          </div>
          <PageLink href={permalinkOf(item.message)} className="justify-self-start text-sm font-medium text-link underline-offset-2 hover:underline">
            View in conversation
          </PageLink>
        </div>
      )}
      {item.list === "todo" && (
        <div className="flex flex-wrap items-center gap-2">
          <ReminderMenu item={item} onRemind={(at) => actions.remind(item, at)}>
            <DropdownMenuTrigger className={TOOLBAR_BUTTON}>
              <Clock className="size-4" />
              {item.remindAt === null ? (
                "Add reminder"
              ) : item.reminded && item.completedAt === null ? (
                <span className="text-negative">Overdue · {shortDateLabel(new Date(item.remindAt))}</span>
              ) : (
                `Reminder: ${dateTimeLabel(new Date(item.remindAt))}`
              )}
            </DropdownMenuTrigger>
          </ReminderMenu>
        </div>
      )}
    </div>
  );
}

/**
 * A note of your own, new or kept, in the message editor, with its files, which upload as they're
 * chosen, and Add or Save changes.
 */
interface NoteEditorProps {
  item?: SavedItem;
  /** Where its unsaved text is kept in this browser, as a message's draft is, until it's saved. */
  draftKey: string;
  typed?: TypedAhead | null;
  onSaved: (item: SavedItem) => void;
  onFailed: (error: unknown) => void;
}

function NoteEditor({ item, draftKey, typed = null, onSaved, onFailed }: NoteEditorProps) {
  // What was written and not saved, last time, through signing out or a reload, or else the note's text.
  const [initialValue] = useState(() => readDraft(draftKey) ?? item?.body ?? "");
  const editor = useRef<RichTextEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<NoteFile[]>(item?.files ?? []);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formats, setFormats] = useState<Formats>(NO_FORMATS);
  const [linkOpen, setLinkOpen] = useState(false);
  // A phone keeps the formatting tools behind Aa, which swaps them in for the buttons, as the composer does.
  const phone = usePhoneLayout();
  const [toolsShown, setToolsShown] = useState(false);
  const mounted = useMounted();

  const attach = async (chosen: FileList | null) => {
    if (!chosen) return;
    for (const file of [...chosen].slice(0, MAX_NOTE_FILES - files.length)) {
      setUploading((n) => n + 1);
      try {
        const sent = await uploadNoteFile(file);
        if (mounted.current) setFiles((files) => [...files, sent]);
      } catch (error) {
        onFailed(error);
      } finally {
        if (mounted.current) setUploading((n) => n - 1);
      }
    }
  };

  // Saving waits for files still uploading, as Add does, and saves once at a time, however often it's pressed.
  const savingNow = useRef(false);
  const save = async () => {
    if (savingNow.current || uploading > 0) return;
    const body = editor.current?.value() ?? "";
    if ((editor.current?.isBlank() ?? true) && files.length === 0) return editor.current?.focus();
    savingNow.current = true;
    setSaving(true);
    try {
      const fileIds = files.map(({ id }) => id);
      const saved = item ? await changeItem(item.id, { body, fileIds }) : await keepItem({ list: "todo", body, ...(fileIds.length > 0 && { fileIds }) });
      keepDraft(draftKey, null);
      if (mounted.current) onSaved(saved);
    } catch (error) {
      if (!isSignedOut(error) || mounted.current) onFailed(error);
    } finally {
      savingNow.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const toolbar = (className?: string) => (
    <ComposerToolbar
      formats={formats}
      disabled={saving}
      onFormat={(format) => editor.current?.format(format)}
      onBlock={(block) => editor.current?.setBlock(block)}
      onLink={(url, text) => editor.current?.link(url, text)}
      linkDraft={() => editor.current?.linkDraft() ?? { text: "", url: "" }}
      linkOpen={linkOpen}
      onLinkOpenChange={setLinkOpen}
      onReturnFocus={() => editor.current?.focus()}
      groups={phone ? PHONE_TOOL_GROUPS : undefined}
      className={className}
    />
  );

  return (
    <form
      // The composer's styles: its text 16px on phones and touch screens, so iOS doesn't zoom in on it.
      className="composer grid gap-3"
      data-toolbar=""
      onFocus={(event) => {
        // The text takes what was typed while it opened, once it can.
        if (!typed || !(event.target as HTMLElement).isContentEditable) return;
        const text = typed.take();
        if (text) requestAnimationFrame(() => editor.current?.insertText(text));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {/* The composer's card, as the message box draws it: the formatting toolbar, the text, and its buttons. */}
      <div className="flex min-h-[132px] min-w-0 flex-col rounded-[12px] border border-input bg-surface p-3 focus-within:border-ring focus-within:shadow-[0_0_0_1px_var(--ring)] max-md:p-2.5">
        {!phone && toolbar()}
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="min-h-12 py-1 text-muted-foreground">What’s on your to-do list?</div>}>
            <RichTextEditor
              ref={editor}
              label="To-do"
              placeholder="What’s on your to-do list?"
              rows={2}
              initialValue={initialValue}
              onChange={() => keepDraft(draftKey, editor.current?.isBlank() ? null : (editor.current?.value() ?? null))}
              mentionsFrom="/api/autocompletable/users"
              autoFocus={item === undefined || typed !== null}
              toolbar={false}
              onFormats={setFormats}
              onKeyDown={(event) => {
                // Cmd or Ctrl+Enter saves, as it sends a message being edited.
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !editor.current?.hasOpenPrompt()) {
                  event.preventDefault();
                  event.stopPropagation();
                  void save();
                }
              }}
            />
          </Suspense>
        </div>
        {files.length > 0 && (
          <ul className="grid gap-2 py-2">
            {files.map((file) => (
              <li key={file.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Attachment file={file} />
                </div>
                <button type="button" aria-label={`Remove ${file.name}`} className={ROW_ACTION} onClick={() => setFiles((files) => files.filter((f) => f.id !== file.id))}>
                  <Xmark />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-none items-center gap-0.5">
          <input
            ref={picker}
            type="file"
            multiple
            aria-label="Attach a file"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => void attach(event.currentTarget.files).finally(() => picker.current && (picker.current.value = ""))}
          />
          {phone && toolsShown ? (
            <>
              <button
                type="button"
                title="Hide formatting"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setToolsShown(false);
                  editor.current?.focus();
                }}
                className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground"
              >
                <Xmark className="size-5" />
                <span className="sr-only">Hide formatting</span>
              </button>
              {toolbar("mx-0 min-w-0 flex-1 pb-0")}
            </>
          ) : (
            <>
              <button
                type="button"
                aria-label={uploading > 0 ? "Uploading…" : "Attach a file"}
                title="Attach a file"
                disabled={saving || files.length >= MAX_NOTE_FILES}
                className={ATTACH_BUTTON}
                onClick={() => picker.current?.click()}
              >
                <Plus className="size-[18px]" />
              </button>
              {phone && (
                <FormattingToggle
                  disabled={saving}
                  shown={false}
                  onToggle={() => {
                    setToolsShown(true);
                    editor.current?.focus();
                  }}
                />
              )}
              <EmojiButton disabled={saving} onPick={(emoji) => editor.current?.insertText(emoji)} onReturnFocus={() => editor.current?.focus()} />
              <MentionButton disabled={saving} onMention={() => editor.current?.startMention()} />
              {uploading > 0 && <span className="ml-2 text-[13px] text-muted-foreground">Uploading…</span>}
              <span className="flex-1" />
            </>
          )}
          <button type="submit" disabled={saving || uploading > 0} className="inline-flex min-h-8 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold hover:bg-hover disabled:opacity-60 touch:min-h-11">
            {item ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
