import { Suspense, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
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
  type SavedItem,
  type SavedList,
  type StoredFile,
} from "@ember/protocol";
import {
  ArrowLeft,
  Attachment as AttachmentIcon,
  Bookmark,
  CheckCircle,
  CheckCircleSolid,
  Clock,
  Edit,
  FilterList,
  MoreHoriz,
  NavArrowDown,
  NavArrowRight,
  Page,
  Plus,
  Sort,
  Trash,
  Xmark,
} from "@/components/icons/iconoir";
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
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMounted } from "@/hooks/use-mounted";
import { navigate, permalinkOf } from "@/hooks/use-route";
import { useTitle } from "@/hooks/use-title";
import { isSignedOut } from "@/lib/api";
import { dateOf, FILTER_LABELS, FILTERS, localInputValue, originOf, reminderChoices, shows, sorted, SORT_LABELS, SORTS, summaryOf, type KeptFilter, type KeptSort } from "@/lib/kept";
import { dateLabel, dateTimeLabel } from "@/lib/messages";
import { clearItem, keepItem, useSavedVersion } from "@/lib/saved";
import { changeItem, fetchSavedList, uploadNoteFile } from "@/lib/saved-lists";
import { cn } from "@/lib/utils";
import { Attachment } from "./attachment";
import { ATTACH_BUTTON } from "./composer-buttons";
import { EmojiButton, MentionButton } from "./composer-menus";
import { ComposerToolbar } from "./composer-toolbar";
import { NO_FORMATS, type Formats } from "./formatting";
import { RichTextEditor, type RichTextEditorHandle } from "./editor";
import { MessageItem, type MessageEditors } from "./message-item";
import { HEADER_TEXT_BUTTON, PageHeader } from "./page-header";
import type { RoomPanes } from "./room-view";
import { ONE_PANE, SplitPanes, type Pane, type PaneStack } from "./split-panes";
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
  "inline-flex min-h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover touch:min-h-11 aria-expanded:bg-hover";

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

  // Loads again whenever what you keep changes, here or in another tab, so a moved item leaves this list.
  useEffect(() => {
    let current = true;
    fetchSavedList(list).then(
      (loaded) => current && setItems(loaded),
      (error: unknown) => current && onFailed(error),
    );
    return () => {
      current = false;
    };
  }, [list, version, onFailed]);

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
      setItems((items) => items && items.filter((i) => i.id !== item.id));
      if (item.id === itemId) navigate(savedPath(list), { replace: true });
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
  };

  const startNew = () => {
    setCreating(true);
    if (itemId !== undefined) navigate(savedPath(list));
  };
  const created = (item: SavedItem) => {
    setItems((items) => items && [item, ...items.filter((i) => i.id !== item.id)]);
    setCreating(false);
    navigate(savedPath(list, item.id));
  };
  const closeDetail = () => {
    setCreating(false);
    if (itemId !== undefined) navigate(savedPath(list));
  };
  const detailOpen = creating || itemId !== undefined;

  const row = (item: SavedItem) => (
    <KeptRow key={item.id} item={item} list={list} selected={item.id === itemId} origin={originOf(item, roomsById, me.id, nameOf)} me={me} actions={actions} />
  );
  const nameOf = useNameOf();
  const inProgress = shown.filter((item) => item.completedAt === null);
  const completed = shown.filter((item) => item.completedAt !== null);

  const header = (
    <>
      <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">{names.title}</h1>
      {list === "todo" && (
        <button type="button" className={cn(HEADER_TEXT_BUTTON, "border-border")} onClick={startNew}>
          <CheckCircle className="size-4" />
          Add To-do
        </button>
      )}
    </>
  );
  const listPane = (
    <section aria-label={names.title} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      {/* On phones the page's own header, with the drawer's button, stands over the list instead. */}
      <div className="flex min-h-header items-center gap-3 border-b px-[22px] py-2.5 max-md:hidden">{header}</div>
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <FilterMenu list={list} filter={filter} onFilter={setFilter} />
        <span className="flex-1" />
        <SortMenu list={list} sort={sort} onSort={setSort} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {items === null ? (
          <p className="p-6 text-center text-muted-foreground">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">{filter === "all" ? names.empty : "Nothing matches"}</p>
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

  const phone = useMediaQuery(ONE_PANE);
  // A saved message opens where it is, in its conversation, as Slack's do; anything else opens its details.
  const place = list === "saved" && selected?.message && renderRoom ? placeOfMessage(selected.message, thread) : null;
  const detail = creating ? (
    <Detail title={names.item} onClose={closeDetail}>
      <NoteEditor key="new" onSaved={created} onFailed={failed} />
    </Detail>
  ) : place && renderRoom ? (
    <div className="flex h-full min-h-0 flex-col border-l bg-background" onClickCapture={(event) => openThreadForLink(event, place, setThread)}>
      {/* Where the list doesn't show beside it, as on a phone, a way back to it. */}
      {(phone || hiddenPanes > 0) && (
        <button type="button" onClick={closeDetail} className="flex min-h-11 shrink-0 items-center gap-2 border-b px-4 pt-[env(safe-area-inset-top)] text-sm font-semibold hover:bg-hover">
          <ArrowLeft className="size-[18px]" />
          {names.title}
        </button>
      )}
      <div className="min-h-0 flex-1">{renderRoom(place, { thread: threadPane, onCloseThread: () => setThread("closed") })}</div>
    </div>
  ) : selected ? (
    <Detail title={names.item} onClose={closeDetail}>
      <ItemDetail key={selected.id} item={selected} me={me} origin={originOf(selected, roomsById, me.id, nameOf)} actions={actions} onChanged={replaced} onFailed={failed} />
    </Detail>
  ) : itemId !== undefined && items !== null ? (
    <Detail title={names.item} onClose={closeDetail}>
      <p className="text-muted-foreground">That item isn’t in your {names.title.toLowerCase()}.</p>
    </Detail>
  ) : (
    // Nothing open: the pane stays quiet, with the list's icon faded in its middle.
    <MainContent aria-label={names.item} className="grid h-full place-content-center border-l bg-background p-6">
      {list === "todo" ? <CheckCircle className="size-24 text-hover" strokeWidth={1} /> : <Bookmark className="size-24 text-hover" strokeWidth={1} />}
    </MainContent>
  );

  const panes: Pane[] = [
    { id: "list", label: `Resize ${names.title}`, minWidth: 320, defaultShare: place ? 0.32 : 0.42, content: listPane },
    { id: "detail", label: `Resize ${names.title}`, minWidth: 360, defaultShare: place ? 0.68 : 0.58, onClose: detailOpen ? closeDetail : undefined, content: detail },
  ];
  if (phone && !detailOpen) panes.pop();
  if (place?.threadId !== undefined)
    panes.push({ id: "thread", label: "Resize thread", minWidth: 300, defaultShare: 0.3, onClose: () => setThread("closed"), content: <div ref={setThreadPane} className="h-full min-h-0" /> });

  return (
    <>
      <div className={cn("hidden", !detailOpen && "max-md:contents")}>
        <PageHeader>{header}</PageHeader>
      </div>
      <SplitPanes
        layoutKey={list === "todo" ? "todos" : "saved"}
        panes={panes}
        onLayout={onPaneStack}
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

function FilterMenu({ list, filter, onFilter }: { list: SavedList; filter: KeptFilter; onFilter: (filter: KeptFilter) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Filter: ${FILTER_LABELS[filter]}`} className={TOOLBAR_BUTTON}>
        <FilterList className="size-4" />
        {filter === "all" ? "Filter" : FILTER_LABELS[filter]}
        <NavArrowDown className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={filter} onValueChange={(value) => onFilter(value as KeptFilter)}>
          {FILTERS[list].map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {FILTER_LABELS[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortMenu({ list, sort, onSort }: { list: SavedList; sort: KeptSort; onSort: (sort: KeptSort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Sort: ${SORT_LABELS[sort]}`} className={TOOLBAR_BUTTON}>
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
}

/** Who a row shows: the message's author, or you for a note of your own. */
const faceOf = (item: SavedItem, me: Me) => item.message?.creator ?? me;

function KeptRow({ item, list, selected, origin, me, actions }: { item: SavedItem; list: SavedList; selected: boolean; origin: string; me: Me; actions: RowActions }) {
  const date = dateOf(item);
  const file = item.message?.attachment;
  const gone = item.kind !== "note" && !item.message;
  const done = item.completedAt !== null;
  const nameOf = useNameOf();
  return (
    <li className={cn("group/row relative flex items-start gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-hover", selected && "bg-hover")}>
      {gone ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground">
          <Page className="size-5" />
        </span>
      ) : file ? (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-muted-foreground" title={file.contentType}>
          <AttachmentIcon className="size-5" />
        </span>
      ) : (
        <UserAvatar user={faceOf(item, me)} className="size-9 shrink-0" />
      )}
      <button
        type="button"
        onClick={() => actions.open(item)}
        aria-current={selected ? "true" : undefined}
        className="min-w-0 flex-1 cursor-pointer text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-foreground"
      >
        <span className={cn("block truncate text-[15px]", gone && "text-muted-foreground italic", done && "text-muted-foreground line-through")}>
          {done && <span className="sr-only">Completed: </span>}
          {summaryOf(item)}
        </span>
        <span className="block truncate text-[13px] text-muted-foreground">
          {file && item.message && (
            <>
              {nameOf(item.message.creator)} · {file.contentType.split("/").at(-1)?.toUpperCase()} ·{" "}
            </>
          )}
          {origin && <>{origin} · </>}
          <time dateTime={date} title={dateTimeLabel(new Date(date))}>
            {dateLabel(new Date(date))}
          </time>
          {item.remindAt && !done && (
            <>
              {" · "}
              {item.reminded ? (
                <span className="text-negative">Overdue</span>
              ) : (
                <>
                  <Clock className="inline size-3.5 align-[-2px]" /> {dateTimeLabel(new Date(item.remindAt))}
                </>
              )}
            </>
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
  const movable = !(list === "todo" && item.kind === "note");
  return (
    <>
      <div className="absolute top-1/2 right-3 z-1 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg border bg-background p-0.5 shadow-sm group-focus-within/row:flex group-hover/row:flex touch:hidden!">
        {list === "todo" && (
          <button type="button" title={done ? "Mark in progress" : "Mark completed"} aria-label={done ? "Mark in progress" : "Mark completed"} className={ROW_ACTION} onClick={() => actions.complete(item)}>
            {done ? <CheckCircleSolid /> : <CheckCircle />}
          </button>
        )}
        {list === "todo" && (
          <button type="button" title="Edit" aria-label="Edit" className={ROW_ACTION} onClick={() => actions.open(item)}>
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
        {movable && (
          <button type="button" title={moveLabel} aria-label={moveLabel} className={ROW_ACTION} onClick={() => actions.move(item)}>
            {list === "todo" ? <Bookmark /> : <CheckCircle />}
          </button>
        )}
        <button type="button" title="Clear" aria-label="Clear" className={ROW_ACTION} onClick={() => actions.clear(item)}>
          <Trash />
        </button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Item actions" className={cn(ROW_ACTION, "relative z-1 hidden size-11 shrink-0 self-center touch:grid")}>
          <MoreHoriz />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {list === "todo" && <DropdownMenuItem onSelect={() => actions.complete(item)}>{done ? "Mark in progress" : "Mark completed"}</DropdownMenuItem>}
          {list === "todo" && <DropdownMenuItem onSelect={() => actions.open(item)}>Edit</DropdownMenuItem>}
          {movable && <DropdownMenuItem onSelect={() => actions.move(item)}>{moveLabel}</DropdownMenuItem>}
          {list === "todo" && (
            <>
              <DropdownMenuSeparator />
              {reminderChoices(new Date()).map(({ label, at }) => (
                <DropdownMenuItem key={label} onSelect={() => actions.remind(item, at)}>
                  Remind me {label.charAt(0).toLowerCase() + label.slice(1)}
                </DropdownMenuItem>
              ))}
              {item.remindAt && <DropdownMenuItem onSelect={() => actions.remind(item, null)}>Remove reminder</DropdownMenuItem>}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => actions.clear(item)}>
            Clear
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Add reminder's menu, around its trigger: the times it offers, a time of your own, and Remove reminder once one is set. */
function ReminderMenu({ item, onRemind, children }: { item: SavedItem; onRemind: (at: Date | null) => void; children: ReactNode }) {
  const [custom, setCustom] = useState(false);
  return (
    <DropdownMenu onOpenChange={(open) => !open && setCustom(false)}>
      {children}
      <DropdownMenuContent align="end" className="min-w-56">
        {custom ? (
          <form
            className="grid gap-2 p-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = new FormData(event.currentTarget).get("at");
              if (typeof value === "string" && value) onRemind(new Date(value));
            }}
          >
            <label className="grid gap-1 text-[13px]">
              Remind me at
              <input name="at" type="datetime-local" required defaultValue={localInputValue(new Date(Date.now() + 3_600_000))} className="rounded-md border bg-background px-2 py-1 text-base" />
            </label>
            <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background">
              Set reminder
            </button>
          </form>
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

/** The pane beside the list: its title and ×, over what's open. */
function Detail({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <MainContent className="flex h-full min-h-0 flex-col border-l bg-background">
      <div className="flex min-h-header items-center gap-2 border-b px-5 max-md:min-h-14 max-md:pt-[env(safe-area-inset-top)]">
        <h2 className="flex-1 text-[17px] font-[650]">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="grid size-9 cursor-pointer place-items-center rounded-lg hover:bg-hover touch:size-11">
          <Xmark className="size-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
    </MainContent>
  );
}

interface ItemDetailProps {
  item: SavedItem;
  me: Me;
  origin: string;
  actions: RowActions;
  onChanged: (item: SavedItem) => void;
  onFailed: (error: unknown) => void;
}

/** An item opened beside its list: a note to edit, or the message it keeps, with its reminder and status. */
function ItemDetail({ item, me, origin, actions, onChanged, onFailed }: ItemDetailProps) {
  return (
    <div className="grid gap-4">
      {item.kind === "note" ? (
        <NoteEditor item={item} onSaved={onChanged} onFailed={onFailed} />
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
              {item.remindAt ? `Reminder: ${dateTimeLabel(new Date(item.remindAt))}` : "Add reminder"}
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
function NoteEditor({ item, onSaved, onFailed }: { item?: SavedItem; onSaved: (item: SavedItem) => void; onFailed: (error: unknown) => void }) {
  const editor = useRef<RichTextEditorHandle>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<NoteFile[]>(item?.files ?? []);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formats, setFormats] = useState<Formats>(NO_FORMATS);
  const [linkOpen, setLinkOpen] = useState(false);
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

  const save = async () => {
    const body = editor.current?.value() ?? "";
    if ((editor.current?.isBlank() ?? true) && files.length === 0) return editor.current?.focus();
    setSaving(true);
    try {
      const fileIds = files.map(({ id }) => id);
      const saved = item ? await changeItem(item.id, { body, fileIds }) : await keepItem({ list: "todo", body, ...(fileIds.length > 0 && { fileIds }) });
      if (mounted.current) onSaved(saved);
    } catch (error) {
      if (!isSignedOut(error) || mounted.current) onFailed(error);
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {/* The composer's card, as the message box draws it: the formatting toolbar, the text, and its buttons. */}
      <div className="flex min-h-[132px] min-w-0 flex-col rounded-[12px] border bg-surface p-3 focus-within:border-muted-foreground max-md:p-2.5">
        <ComposerToolbar
          formats={formats}
          disabled={saving}
          onFormat={(format) => editor.current?.format(format)}
          onBlock={(block) => editor.current?.setBlock(block)}
          onLink={(url) => editor.current?.link(url)}
          linkOpen={linkOpen}
          onLinkOpenChange={setLinkOpen}
          onReturnFocus={() => editor.current?.focus()}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={<div className="min-h-12 py-1 text-muted-foreground">What’s on your to-do list?</div>}>
            <RichTextEditor
              ref={editor}
              label="To-do"
              placeholder="What’s on your to-do list?"
              rows={2}
              initialValue={item?.body ?? ""}
              mentionsFrom="/api/autocompletable/users"
              autoFocus={item === undefined}
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
          <EmojiButton disabled={saving} onPick={(emoji) => editor.current?.insertText(emoji)} onReturnFocus={() => editor.current?.focus()} />
          <MentionButton disabled={saving} onMention={() => editor.current?.startMention()} />
          {uploading > 0 && <span className="ml-2 text-[13px] text-muted-foreground">Uploading…</span>}
          <span className="flex-1" />
          <button type="submit" disabled={saving || uploading > 0} className="inline-flex min-h-8 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold hover:bg-hover disabled:opacity-60 touch:min-h-11">
            {item ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </form>
  );
}
