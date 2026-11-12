import { useContext, useId, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import type { Me, Room, RoomId, UserId } from "@ember/protocol";
import {
  ANY_TIME,
  FILE_SORT_LABELS,
  FILE_SORTS,
  FILE_TYPE_LABELS,
  FILE_TYPES,
  filtersOn,
  type FileDate,
  type FileFilters,
  type FileSort,
  type FileType,
  type LibraryFile,
} from "@ember/protocol/library";
import {
  Code,
  Download,
  EmptyPage,
  FilterList,
  JournalPage,
  MediaImage,
  MediaVideo,
  MoreVert,
  MusicDoubleNote,
  NavArrowDown,
  OpenNewWindow,
  Page,
  PageEdit,
  Presentation,
  Search as SearchIcon,
  Sort,
  Star,
  StarSolid,
  Table2Columns,
  type IconoirIconProps,
} from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PeopleContext } from "@/hooks/use-directory";
import { useMediaQuery } from "@/hooks/use-media-query";
import { messagePath, navigate, roomPath } from "@/hooks/use-route";
import { roomTabAddress } from "@/lib/library";
import { dateLabel, dateTimeLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { RoomMark, type SearchNames } from "./search-box";

// What the Files page and a room's Files & links share: the search, the filters and the order over the list,
// and each file's row.

const TYPE_ICONS: Record<FileType, ComponentType<IconoirIconProps>> = {
  documents: Page,
  spreadsheets: Table2Columns,
  presentations: Presentation,
  pdfs: JournalPage,
  images: MediaImage,
  videos: MediaVideo,
  audio: MusicDoubleNote,
  snippets: Code,
  other: EmptyPage,
};

/** Each kind of file's icon on a tile in its color, as Slack's Files page shows them; a canvas has its own. */
export function FileTypeIcon({ file, className }: { file: Pick<LibraryFile, "kind" | "type">; className?: string }) {
  const Icon = file.kind === "canvas" ? PageEdit : TYPE_ICONS[file.type];
  return (
    <span aria-hidden className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-hover text-foreground", className)}>
      <Icon className="size-5" />
    </span>
  );
}

/** A pill-shaped menu button, as the search page's sort is. */
export const PILL =
  "inline-flex min-h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap hover:bg-hover touch:min-h-11 touch:min-w-11 aria-expanded:bg-hover [&>svg]:size-4 [&>svg]:shrink-0";

/** A pill that's on: inked, as a pressed chip is. */
const PILL_ON = "border-foreground bg-foreground text-background hover:bg-foreground aria-expanded:bg-foreground";

/** The kinds of file to show, as a menu of checkboxes, saying how many are picked. */
export function TypesMenu({ types, onChange }: { types: FileType[]; onChange: (types: FileType[]) => void }) {
  const label = types.length === 0 ? "Types" : types.length === 1 ? FILE_TYPE_LABELS[types[0]!] : `${types.length} Types`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`File types: ${types.length === 0 ? "all" : label}`} className={cn(PILL, types.length > 0 && PILL_ON)}>
        <FilterList />
        <span>{label}</span>
        <NavArrowDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {FILE_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={types.includes(type)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => onChange(checked ? [...types, type] : types.filter((other) => other !== type))}
          >
            <TypeIconOf type={type} />
            {FILE_TYPE_LABELS[type]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TypeIconOf({ type }: { type: FileType }) {
  const Icon = TYPE_ICONS[type];
  return <Icon className="size-4" />;
}

/** The order the list takes, as a menu. */
export function SortMenu({ sort, onSort, sorts = FILE_SORTS }: { sort: FileSort; onSort: (sort: FileSort) => void; sorts?: readonly FileSort[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Sort: ${FILE_SORT_LABELS[sort]}`} className={PILL}>
        <Sort />
        <span className="max-md:sr-only">{FILE_SORT_LABELS[sort]}</span>
        <NavArrowDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSort(value as FileSort)}>
          {sorts.map((order) => (
            <DropdownMenuRadioItem key={order} value={order}>
              {FILE_SORT_LABELS[order]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The search over a list of files, a field with a magnifying glass. */
export function FileSearch({ value, onChange, label }: { value: string; onChange: (q: string) => void; label: string }) {
  return (
    <label className="flex min-h-10 w-full items-center gap-2 rounded-[9px] border bg-background px-3 focus-within:border-muted-foreground touch:min-h-11">
      <SearchIcon className="size-[18px] shrink-0 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground max-md:text-base"
      />
    </label>
  );
}

const DATES: Array<{ value: string; label: string; date: FileDate }> = [
  { value: "any", label: "Any time", date: ANY_TIME },
  { value: "today", label: "Today", date: { within: "today" } },
  { value: "7d", label: "Last 7 days", date: { within: "7d" } },
  { value: "30d", label: "Last 30 days", date: { within: "30d" } },
];

const dateValueOf = (date: FileDate) => ("from" in date ? "range" : date.within);

const today = () => new Date().toLocaleDateString("sv");

const SELECT = "h-10 w-full rounded-[9px] border bg-background px-3 text-[15px] text-foreground outline-none focus:border-muted-foreground touch:h-11 max-md:text-base";

interface FilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: Me;
  filters: FileFilters;
  /** The rooms "In" offers, or null where the list is one room's. */
  rooms: readonly Room[] | null;
  names: SearchNames;
  onApply: (filters: Pick<FileFilters, "from" | "in" | "date">) => void;
  /** Takes off every filter, Types and whose files included, leaving the words searched for. */
  onClear: () => void;
}

/**
 * Filter by: whose files, in which room, and when they were sent, with Done, as Slack's dialog has them,
 * and Clear filters, which takes every filter off at once and closes it.
 */
export function FilterDialog({ open, onOpenChange, me, filters, rooms, names, onApply, onClear }: FilterDialogProps) {
  const people = useContext(PeopleContext);
  const [from, setFrom] = useState<UserId | "">(filters.from ?? "");
  const [inRoom, setInRoom] = useState<RoomId | "">(filters.in ?? "");
  const [date, setDate] = useState<FileDate>(filters.date);
  const id = useId();
  const everyone = useMemo(() => [...people.values()].filter((person) => person.id !== me.id).sort((a, b) => a.name.localeCompare(b.name)), [people, me.id]);
  const sortedRooms = useMemo(() => (rooms ? [...rooms].sort((a, b) => names.roomName(a).localeCompare(names.roomName(b))) : []), [rooms, names]);
  const done = () => {
    onApply({ ...(from && { from }), ...(inRoom && { in: inRoom }), date });
    onOpenChange(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(opening) => {
        if (opening) {
          setFrom(filters.from ?? "");
          setInRoom(filters.in ?? "");
          setDate(filters.date);
        }
        onOpenChange(opening);
      }}
    >
      <DialogContent className="max-w-[480px] gap-5">
        <DialogTitle className="text-xl font-bold">Filter by</DialogTitle>
        <DialogDescription className="sr-only">Whose files, in which conversation, and when they were shared.</DialogDescription>
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-from`} className="text-sm font-semibold">
            From
          </label>
          <select id={`${id}-from`} value={from} onChange={(event) => setFrom(event.target.value)} className={SELECT}>
            <option value="">Anyone</option>
            <option value={me.id}>Me</option>
            {everyone.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        {rooms && (
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-in`} className="text-sm font-semibold">
              In
            </label>
            <select id={`${id}-in`} value={inRoom} onChange={(event) => setInRoom(event.target.value)} className={SELECT}>
              <option value="">Any conversation</option>
              {sortedRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.kind === "direct" ? names.roomName(room) : `# ${names.roomName(room)}`}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-date`} className="text-sm font-semibold">
            Date
          </label>
          <select
            id={`${id}-date`}
            value={dateValueOf(date)}
            onChange={(event) => setDate(event.target.value === "range" ? { from: today(), to: today() } : DATES.find(({ value }) => value === event.target.value)!.date)}
            className={SELECT}
          >
            {DATES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
            <option value="range">Custom range…</option>
          </select>
          {"from" in date && (
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-[13px] text-muted-foreground">
                From
                <input type="date" value={date.from} max={date.to} onChange={(event) => setDate({ ...date, from: event.target.value })} className={SELECT} />
              </label>
              <label className="grid gap-1 text-[13px] text-muted-foreground">
                To
                <input type="date" value={date.to} min={date.from} onChange={(event) => setDate({ ...date, to: event.target.value })} className={SELECT} />
              </label>
            </div>
          )}
        </div>
        <DialogFooter className="items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClear();
              onOpenChange(false);
            }}
          >
            Clear filters
          </Button>
          <Button type="button" onClick={done}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The button that opens Filter by, inked with how many filters are on. */
export function FilterButton({ filters, onClick }: { filters: FileFilters; onClick: () => void }) {
  const on = filtersOn(filters);
  return (
    <button type="button" onClick={onClick} aria-label={on ? `Filters, ${on} on` : "Filters"} title="Filter by" className={cn(PILL, on > 0 && PILL_ON)}>
      <FilterList />
      {on > 0 && <span>{on}</span>}
    </button>
  );
}

/** Where opening a file goes: its own address, in a new tab, or a canvas's tab in its room. */
export const openAddress = (file: LibraryFile) => (file.kind === "canvas" ? roomTabAddress(roomPath(file.roomId), file.id) : file.file!.url);

/** How a file's size reads: "512 B", "1.2 KB", "3.4 MB". */
export function sizeLabel(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1000;
  let unit = 0;
  while (size >= 1000 && unit < units.length - 1) {
    size /= 1000;
    unit++;
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${units[unit]}`;
}

/** A button in a row that holds only an icon. */
const ROW_BUTTON = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground touch:size-11 [&>svg]:size-[18px]";

interface FileRowProps {
  file: LibraryFile;
  room: Room | null;
  names: SearchNames;
  /** Whether to say which conversation it's in: on the Files page, but not in a room's own tab. */
  showRoom: boolean;
  onOpened: (file: LibraryFile) => void;
  onStar: (file: LibraryFile, starred: boolean) => void;
}

/** How long a finger has to stay on a row for its menu to open. */
const LONG_PRESS_MS = 500;

/**
 * What has a row open its menu, `open`, on a touch screen as a finger holds it, or as it's held long enough
 * for the browser's own menu, and makes the tap that ends the hold open nothing.
 */
export function useLongPress(open: () => void) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; held: boolean } | null>(null);
  const released = () => {
    if (press.current && !press.current.held) clearTimeout(press.current.timer);
  };
  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const timer = setTimeout(() => {
        press.current = { timer, held: true };
        open();
      }, LONG_PRESS_MS);
      press.current = { timer, held: false };
    },
    onPointerUp: released,
    onPointerCancel: released,
    onPointerLeave: released,
    onClickCapture: (event: React.MouseEvent) => {
      if (press.current?.held) event.preventDefault();
      press.current = null;
    },
    onContextMenu: (event: React.MouseEvent) => {
      if (!matchMedia("(pointer: coarse)").matches) return;
      event.preventDefault();
      open();
    },
  };
}

/** A row's actions that show as the pointer or focus reaches it, or that it opens its menu with. */
export const ROW_ACTIONS = "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100";

/**
 * A file's row: its kind's icon, its name, which opens it, who shared it and when, or when you last opened
 * it. Its actions, open, star, download and more, show as the pointer or focus reaches it; a star stays
 * on a starred file, which is how it shows it's starred. On a touch screen, holding the row opens its
 * menu, which then holds every action.
 */
export function FileRow({ file, room, names, showRoom, onOpened, onStar }: FileRowProps) {
  const created = new Date(file.createdAt);
  const canvas = file.kind === "canvas";
  const touch = useMediaQuery("(pointer: coarse)");
  const [menuOpen, setMenuOpen] = useState(false);
  const holding = useLongPress(() => setMenuOpen(true));
  const opened = (event: React.MouseEvent) => {
    onOpened(file);
    if (!canvas) return;
    event.preventDefault();
    navigate(openAddress(file));
  };
  const when = file.viewedAt ? `Last viewed ${dateLabel(new Date(file.viewedAt))}` : dateLabel(created);
  const star = (
    <button type="button" aria-pressed={file.starred} title={file.starred ? "Unstar" : "Star"} onClick={() => onStar(file, !file.starred)} className={ROW_BUTTON}>
      {file.starred ? <StarSolid /> : <Star />}
      <span className="sr-only">
        {file.starred ? "Unstar" : "Star"} {file.name}
      </span>
    </button>
  );
  return (
    <li
      {...holding}
      className="group relative flex min-h-[68px] items-center gap-3 rounded-lg px-3 py-2 [-webkit-touch-callout:none] hover:bg-hover max-md:px-2"
    >
      <FileTypeIcon file={file} />
      <div className="min-w-0 flex-1">
        <a
          href={openAddress(file)}
          onClick={opened}
          {...(!canvas && { target: "_blank", rel: "noopener" })}
          // For fingers, it takes taps anywhere on the row but its buttons, which sit over it.
          className="block truncate text-[15px] font-semibold text-foreground hover:underline touch:after:absolute touch:after:inset-0 touch:after:rounded-lg"
        >
          {file.name}
        </a>
        <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
          <span className="truncate">{names.person(file.owner.id) === "Someone" ? file.owner.name : names.person(file.owner.id)}</span>
          {showRoom && (
            <>
              <span aria-hidden>·</span>
              <RoomMark room={room} size={13} />
              <span className="truncate">{room ? names.roomName(room) : "A conversation you’ve left"}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <time dateTime={file.viewedAt ?? file.createdAt} title={dateTimeLabel(created)} className="shrink-0">
            {when}
          </time>
          {file.file && <span className="shrink-0 max-md:hidden">· {sizeLabel(file.file.byteSize)}</span>}
        </p>
      </div>
      <div className="relative z-[1] flex shrink-0 items-center gap-0.5">
        {!touch && (
          <div className={cn("flex items-center gap-0.5", ROW_ACTIONS)}>
            <a
              href={openAddress(file)}
              onClick={opened}
              {...(!canvas && { target: "_blank", rel: "noopener" })}
              title={canvas ? "Open canvas" : "Open in a new tab"}
              className={ROW_BUTTON}
            >
              <OpenNewWindow />
              <span className="sr-only">Open {file.name}</span>
            </a>
            {!file.starred && star}
            {file.file && (
              <a href={file.file.downloadUrl} download={file.file.name} title="Download" className={ROW_BUTTON}>
                <Download />
                <span className="sr-only">Download {file.name}</span>
              </a>
            )}
          </div>
        )}
        {file.starred && (touch ? <StarSolid aria-label="Starred" className="mx-1 size-[18px] text-muted-foreground" /> : star)}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          {/* On a touch screen, holding the row opens it, and it's only there to place the menu. */}
          <DropdownMenuTrigger title="More actions" tabIndex={touch ? -1 : undefined} className={cn(ROW_BUTTON, ROW_ACTIONS, touch && "pointer-events-none w-0")}>
            <MoreVert />
            <span className="sr-only">More actions for {file.name}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {file.messageId && (
              <DropdownMenuItem asChild>
                <PageLink href={messagePath(file.roomId, file.messageId)}>{room?.kind === "direct" ? "View in conversation" : "View in room"}</PageLink>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => void navigator.clipboard?.writeText(new URL(openAddress(file), location.href).href)}>Copy link</DropdownMenuItem>
            {/* What the row's own buttons do, for a touch screen, which has none. */}
            {touch && file.file && (
              <DropdownMenuItem asChild>
                <a href={file.file.downloadUrl} download={file.file.name}>
                  Download
                </a>
              </DropdownMenuItem>
            )}
            {touch && <DropdownMenuItem onSelect={() => onStar(file, !file.starred)}>{file.starred ? "Unstar" : "Star"}</DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

/** What a list says when nothing's in it, or nothing passes its filters. */
export function NothingHere({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="grid justify-items-center px-6 pt-[8dvh] pb-6 text-center text-muted-foreground">
      <EmptyPage className="mb-4 h-auto w-14 text-foreground opacity-20" />
      <h2 className="mb-1.5 text-lg font-bold text-foreground">{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
