import { Suspense, useCallback, useContext, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { isWebImage, type Me, type RoomId } from "@ember/protocol";
import {
  fileTypeOf,
  isMedia,
  isWebAddress,
  listFiles,
  listLinks,
  MAX_TAB_TITLE_LENGTH,
  NO_FILE_FILTERS,
  type FileFilters,
  type FileSort,
  type FolderItem,
  type Library,
  type LibraryFile,
  type LibraryLink,
  type NewFolderItem,
  type OpenedTab,
  type RoomTab,
  type RoomTabKind,
  type TabFile,
} from "@ember/protocol/library";
import { ArrowDown, ArrowUp, Download, Link as LinkIcon, MediaImage, MediaVideo, OpenNewWindow, Plus, Trash, Xmark } from "@/components/icons/iconoir";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PeopleContext } from "@/hooks/use-directory";
import { messagePath } from "@/hooks/use-route";
import { isSignedOut, type Room } from "@/lib/api";
import { addFolderItem, addTab, fetchFiles, fetchRoomLibrary, markFile, openTab, orderTabs, removeFolderItem, removeTab, renameTab } from "@/lib/library";
import { dateLabel } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { PageLink } from "@/components/page-link";
import { FileRow, FileSearch, FileTypeIcon, FilterButton, FilterDialog, NothingHere, sizeLabel, SortMenu, TypesMenu } from "./file-list";
import { Chip, CHIPS_ROW, useSearchNames } from "./search-box";
import { CanvasEditor, TAB_ICONS, type ShownTab } from "./room-tab-icons";

// What a room's tabs show, and the dialogs that add and edit them, which load once a room's tab other than
// Messages is opened, or its + menu used (room-tabs.tsx).


interface PanelProps {
  room: Room;
  me: Me;
  shown: ShownTab;
  /** The tab as the strip lists it, if it does. */
  tab: RoomTab | null;
  onTabChanged: (tab: RoomTab) => void;
  /** When the tab shown turns out to be gone. */
  onTabGone: () => void;
  onFailed: (error: unknown) => void;
}

/** What the tab shown shows: Files & links, or a tab the members added, once it's opened. */
export function RoomTabPanel({ room, me, shown, onTabChanged, onTabGone, onFailed }: PanelProps) {
  if (shown === "files") return <FilesAndLinks room={room} me={me} onFailed={onFailed} />;
  return <AddedTab room={room} me={me} tabId={shown} onTabChanged={onTabChanged} onTabGone={onTabGone} onFailed={onFailed} />;
}

/** Whether a failure is the tab being gone, which the strip hears of, rather than one to tell of. */
const isGone = (error: unknown) => error instanceof Error && "status" in error && (error as { status: number }).status === 404;

function AddedTab({ room, me, tabId, onTabChanged, onTabGone, onFailed }: { room: Room; me: Me; tabId: string } & Pick<PanelProps, "onTabChanged" | "onTabGone" | "onFailed">) {
  const [opened, setOpened] = useState<OpenedTab | null>(null);
  useEffect(() => {
    let stopped = false;
    openTab(room.id, tabId).then(
      (opened) => !stopped && setOpened(opened),
      (error: unknown) => {
        if (stopped && !isSignedOut(error)) return;
        if (isGone(error)) onTabGone();
        else onFailed(error);
      },
    );
    return () => void (stopped = true);
  }, [room.id, tabId, onTabGone, onFailed]);
  const changed = useCallback(
    (next: OpenedTab) => {
      setOpened(next);
      onTabChanged(next.tab);
    },
    [onTabChanged],
  );
  if (!opened) return null;
  const { tab } = opened;
  if (tab.kind === "canvas")
    return (
      <Suspense fallback={null}>
        <CanvasEditor room={room} me={me} opened={opened} onSaved={changed} onFailed={onFailed} />
      </Suspense>
    );
  if (tab.kind === "folder") return <FolderPanel room={room} me={me} opened={opened} onChanged={changed} onFailed={onFailed} />;
  if (tab.kind === "file" && tab.file) return <FilePreview title={tab.title} roomId={room.id} file={tab.file} />;
  return <NothingHere title={tab.title} />;
}

/** A file a tab holds: the picture or video, or the file's card, with Open and Download, and the message it came in. */
function FilePreview({ title, roomId, file: { messageId, file } }: { title: string; roomId: RoomId; file: TabFile }) {
  const picture = (file.previewUrl !== undefined && file.contentType.startsWith("image/")) || isWebImage(file.contentType);
  const video = file.contentType.startsWith("video/");
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b px-[22px] py-3 max-md:px-3">
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h2>
        <a href={file.url} target="_blank" rel="noopener" className={OUTLINE_BUTTON}>
          <OpenNewWindow className="size-4" /> Open
        </a>
        <a href={file.downloadUrl} download={file.name} className={OUTLINE_BUTTON}>
          <Download className="size-4" /> Download
        </a>
        <PageLink href={messagePath(roomId, messageId)} className={OUTLINE_BUTTON}>
          View message
        </PageLink>
      </div>
      <div className="grid flex-1 place-items-center p-6">
        {picture ? (
          <img src={file.previewUrl ?? file.url} alt={file.name} className="max-h-[70dvh] max-w-full rounded-lg border object-contain" />
        ) : video ? (
          <video src={file.url} poster={file.previewUrl} controls className="max-h-[70dvh] max-w-full rounded-lg border" />
        ) : (
          <div className="flex items-center gap-3 rounded-xl border p-4">
            <FileTypeIcon file={{ kind: "file", type: fileTypeFor(file) }} className="size-12" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{file.name}</p>
              <p className="text-[13px] text-muted-foreground">{sizeLabel(file.byteSize)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const OUTLINE_BUTTON =
  "inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border bg-background px-3 text-[13px] font-medium text-foreground hover:bg-hover touch:min-h-11";

/** The kind of a tab's file, as the Files page reads it. */
const fileTypeFor = (file: TabFile["file"]) => fileTypeOf(file.contentType, file.name);

// Files & links: the room's files, canvases and links, as the Files page lists the workspace's.

type Shelf = "all" | "files" | "media" | "links";
const SHELVES: Array<{ shelf: Shelf; label: string }> = [
  { shelf: "all", label: "All" },
  { shelf: "files", label: "Files" },
  { shelf: "media", label: "Media" },
  { shelf: "links", label: "Links" },
];

/** A row of Files & links: a file or a canvas, or a link. */
type Entry = { file: LibraryFile } | { link: LibraryLink };

const entryDate = (entry: Entry) => ("file" in entry ? entry.file.createdAt : entry.link.createdAt);
const entryName = (entry: Entry) => ("file" in entry ? entry.file.name : entry.link.title);

/** Files and links together, in `sort`'s order, where Recently viewed is newest first. */
function merged(files: LibraryFile[], links: LibraryLink[], sort: FileSort): Entry[] {
  const entries: Entry[] = [...files.map((file) => ({ file })), ...links.map((link) => ({ link }))];
  if (sort === "name") return entries.sort((a, b) => entryName(a).localeCompare(entryName(b), undefined, { sensitivity: "base", numeric: true }));
  const sign = sort === "oldest" ? 1 : -1;
  return entries.sort((a, b) => (entryDate(a) < entryDate(b) ? -sign : entryDate(a) > entryDate(b) ? sign : 0));
}

/**
 * Files & links, after Slack's: a search, All, Files, Media and Links, the kinds of file, the order and Filter by,
 * then the room's newest photos and videos, then everything that passes, a row each.
 */
function FilesAndLinks({ room, me, onFailed }: { room: Room; me: Me; onFailed: (error: unknown) => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [shelf, setShelf] = useState<Shelf>("all");
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS);
  const [sort, setSort] = useState<FileSort>("newest");
  const [filtering, setFiltering] = useState(false);
  const names = useSearchNames(me, useMemo(() => [room], [room]));
  useEffect(() => {
    let stopped = false;
    fetchRoomLibrary(room.id).then(
      (library) => !stopped && setLibrary(library),
      (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [room.id, onFailed]);

  const star = (file: LibraryFile, starred: boolean) => {
    const marked = (starred: boolean) => setLibrary((library) => library && { ...library, files: library.files.map((other) => (other.id === file.id ? { ...other, starred } : other)) });
    marked(starred);
    markFile({ fileId: file.id, roomId: file.roomId, starred }).catch((error: unknown) => {
      marked(file.starred);
      onFailed(error);
    });
  };
  const opened = (file: LibraryFile) => void markFile({ fileId: file.id, roomId: file.roomId, viewed: true }).catch(() => {});

  const shown = useMemo(() => {
    if (!library) return null;
    const files = shelf === "links" ? [] : listFiles(library.files, filters, sort, me.id).filter((file) => (shelf === "media" ? isMedia(file.type) : shelf === "files" ? !isMedia(file.type) : true));
    const links = shelf === "all" || shelf === "links" ? listLinks(library.links, filters, sort, me.id) : [];
    return merged(files, links, sort);
  }, [library, shelf, filters, sort, me.id]);
  const media = useMemo(() => (library ? library.files.filter((file) => isMedia(file.type) && file.file).slice(0, 6) : []), [library]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-3 px-[22px] pt-4 pb-[max(18px,env(safe-area-inset-bottom))] max-md:px-3">
        <FileSearch value={filters.q} onChange={(q) => setFilters({ ...filters, q })} label="Search files and links" />
        <div className="flex items-start gap-2 max-md:flex-col max-md:items-stretch">
          <div role="group" aria-label="Show" className={cn("flex min-w-0 flex-1 gap-2", CHIPS_ROW, "max-md:pl-0")}>
            {SHELVES.map(({ shelf: each, label }) => (
              <Chip key={each} pressed={shelf === each} onClick={() => setShelf(each)}>
                {label}
              </Chip>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {shelf !== "links" && <TypesMenu types={filters.types} onChange={(types) => setFilters({ ...filters, types })} />}
            <SortMenu sort={sort} onSort={setSort} sorts={["newest", "oldest", "name"]} />
            <FilterButton filters={filters} onClick={() => setFiltering(true)} />
          </div>
        </div>
        <FilterDialog
          open={filtering}
          onOpenChange={setFiltering}
          me={me}
          filters={filters}
          rooms={null}
          names={names}
          onApply={({ from, date }) => setFilters({ ...filters, from, date })}
        />
        {media.length > 0 && (shelf === "all" || shelf === "media") && (
          <section aria-labelledby="photos-and-videos" className="pt-1">
            <h2 id="photos-and-videos" className="pb-2 text-[13px] font-semibold text-muted-foreground">
              Photos and videos
            </h2>
            <ul className="grid grid-cols-6 gap-2 max-md:grid-cols-3">
              {media.map((file) => (
                <li key={file.id}>
                  <a href={file.file!.url} target="_blank" rel="noopener" onClick={() => opened(file)} title={file.name} className="relative block aspect-square overflow-hidden rounded-lg border bg-hover">
                    {/* A picture every browser shows, or a preview; an SVG, say, is served as a file, so it shows its kind. */}
                    {file.file!.previewUrl || isWebImage(file.file!.contentType) ? (
                      <img src={file.file!.previewUrl ?? file.file!.url} alt={file.name} loading="lazy" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-muted-foreground">
                        {file.type === "videos" ? <MediaVideo className="size-8" /> : <MediaImage className="size-8" />}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {shown === null ? null : shown.length === 0 ? (
          <NothingHere title={library!.files.length + library!.links.length === 0 ? "Nothing shared here yet" : "Nothing found"}>
            {library!.files.length + library!.links.length === 0 ? "Files and links sent in this conversation show up here." : "Try different words, or take a filter off."}
          </NothingHere>
        ) : (
          <ul aria-label="Files and links" className="flex flex-col">
            {shown.map((entry) =>
              "file" in entry ? (
                <FileRow key={entry.file.id} file={entry.file} room={room} names={names} showRoom={false} onOpened={opened} onStar={star} />
              ) : (
                <LinkRow key={entry.link.id} link={entry.link} names={names} />
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

/** A link's row: the link's icon, what it says, which opens it, its host, and who sent it when. */
function LinkRow({ link, names }: { link: LibraryLink; names: ReturnType<typeof useSearchNames> }) {
  let host = link.url;
  try {
    host = new URL(link.url).host;
  } catch {
    // Kept whole.
  }
  return (
    <li className="group flex min-h-[68px] items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover max-md:px-2">
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
        <LinkIcon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <a href={link.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[15px] font-semibold text-foreground hover:underline">
          {link.title}
        </a>
        <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
          <span className="truncate">{host}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{names.person(link.owner.id) === "Someone" ? link.owner.name : names.person(link.owner.id)}</span>
          <span aria-hidden>·</span>
          <time dateTime={link.createdAt} className="shrink-0">
            {dateLabel(new Date(link.createdAt))}
          </time>
        </p>
      </div>
      <PageLink href={messagePath(link.roomId, link.messageId)} className="shrink-0 rounded-md px-2 py-1 text-[13px] text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-background hover:text-foreground touch:opacity-100 max-md:opacity-100">
        View message
      </PageLink>
    </li>
  );
}

// Folders.

/** A folder's files and links, each opening in a new tab, with Add and remove. */
function FolderPanel({ room, me, opened, onChanged, onFailed }: { room: Room; me: Me; opened: OpenedTab; onChanged: (opened: OpenedTab) => void; onFailed: (error: unknown) => void }) {
  const [adding, setAdding] = useState<"file" | "link" | null>(null);
  const items = opened.items ?? [];
  const remove = (item: FolderItem) => removeFolderItem(room.id, opened.tab.id, item.id).then(onChanged, onFailed);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-3 px-[22px] pt-4 pb-6 max-md:px-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-[650]">{opened.tab.title}</h2>
          <DropdownMenu>
            <DropdownMenuTrigger className={OUTLINE_BUTTON}>
              <Plus className="size-4" /> Add
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setAdding("file")}>A file from this conversation</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setAdding("link")}>A link</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {items.length === 0 ? (
          <NothingHere title="This folder is empty">Add files sent in this conversation, or links.</NothingHere>
        ) : (
          <ul className="flex flex-col">
            {items.map((item) => (
              <li key={item.id} className="group flex min-h-14 items-center gap-3 rounded-lg px-3 py-2 hover:bg-hover">
                {item.file ? (
                  <FileTypeIcon file={{ kind: "file", type: fileTypeFor(item.file.file) }} />
                ) : (
                  <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-hover">
                    <LinkIcon className="size-5" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <a href={item.file?.file.url ?? item.url} target="_blank" rel="noopener noreferrer" className="block truncate font-semibold hover:underline">
                    {item.title}
                  </a>
                  <p className="truncate text-[13px] text-muted-foreground">{item.file ? item.file.file.name : item.url}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  title="Remove from folder"
                  className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-background hover:text-foreground touch:size-11 touch:opacity-100"
                >
                  <Xmark className="size-4" />
                  <span className="sr-only">Remove {item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {adding && (
        <AddDialog
          room={room}
          me={me}
          kind={adding}
          heading={adding === "file" ? "Add a file to this folder" : "Add a link to this folder"}
          onClose={() => setAdding(null)}
          onSubmit={(item) => addFolderItem(room.id, opened.tab.id, item as NewFolderItem).then(onChanged)}
          onFailed={onFailed}
        />
      )}
    </div>
  );
}

// Adding and editing tabs.

const FIELD = "h-10 w-full rounded-[9px] border bg-background px-3 text-[15px] text-foreground outline-none focus:border-muted-foreground touch:h-11 max-md:text-base";

const KIND_HEADINGS: Record<RoomTabKind, string> = { file: "Add a file", link: "Add a link", folder: "Add a folder", canvas: "Add a canvas" };

/** What adding sends: a file's message, a link, or just a name. */
type Added = { kind: "file"; messageId: string; title: string } | { kind: "link"; url: string; title: string } | { kind: "folder" | "canvas"; title: string };

interface AddDialogProps {
  room: Room;
  me: Me;
  kind: RoomTabKind;
  heading: string;
  onClose: () => void;
  onSubmit: (added: Added & ({ kind: "file" } | { kind: "link" })) => Promise<unknown>;
  onFailed: (error: unknown) => void;
}

/** Adding a tab of `kind` to the room: a file sent in it, a link, a folder or a canvas, each with its name. */
export function AddTabDialog({ room, me, kind, onClose, onAdded, onFailed }: { room: Room; me: Me; kind: RoomTabKind; onClose: () => void; onAdded: (tab: RoomTab) => void; onFailed: (error: unknown) => void }) {
  return (
    <AddDialog
      room={room}
      me={me}
      kind={kind}
      heading={KIND_HEADINGS[kind]}
      onClose={onClose}
      onSubmit={async (added) => onAdded((await addTab(room.id, added)).tab)}
      onFailed={onFailed}
    />
  );
}

function AddDialog({ room, me, kind, heading, onClose, onSubmit, onFailed }: Omit<AddDialogProps, "onSubmit"> & { onSubmit: (added: Added) => Promise<unknown> }) {
  const id = useId();
  const [title, setTitle] = useState(kind === "canvas" ? "Untitled" : "");
  const [url, setUrl] = useState("");
  const [picked, setPicked] = useState<LibraryFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (kind === "link" && !isWebAddress(url.trim())) return setError("Links start with http:// or https://");
    if (kind === "file" && !picked) return setError("Pick a file");
    const name = title.trim() || (kind === "file" ? picked!.name : kind === "link" ? url.trim() : "");
    if (!name) return setError("Give it a name");
    setSaving(true);
    setError(null);
    const added: Added =
      kind === "file" ? { kind, messageId: picked!.messageId!, title: name.slice(0, MAX_TAB_TITLE_LENGTH) } : kind === "link" ? { kind, url: url.trim(), title: name.slice(0, MAX_TAB_TITLE_LENGTH) } : { kind, title: name };
    try {
      await onSubmit(added);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (failure instanceof Error && !isSignedOut(failure)) setError(failure.message);
      else onFailed(failure);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px] gap-4">
        <DialogTitle className="text-xl font-bold">{heading}</DialogTitle>
        <DialogDescription className="sr-only">{heading} to this conversation’s tabs.</DialogDescription>
        <form onSubmit={submit} className="grid gap-4">
          {kind === "file" && <FilePicker roomId={room.id} me={me} picked={picked} onPick={setPicked} onFailed={onFailed} />}
          {kind === "link" && (
            <div className="grid gap-1.5">
              <label htmlFor={`${id}-url`} className="text-sm font-semibold">
                Link
              </label>
              <input id={`${id}-url`} type="url" required value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" className={FIELD} autoFocus />
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-title`} className="text-sm font-semibold">
              Name {kind === "file" || kind === "link" ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
            </label>
            <input
              id={`${id}-title`}
              value={title}
              maxLength={MAX_TAB_TITLE_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={kind === "file" ? (picked?.name ?? "") : kind === "link" ? "What it’s called" : ""}
              className={FIELD}
              autoFocus={kind === "folder" || kind === "canvas"}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface FilePickerProps {
  /** The conversation whose files to offer, or every file you can see when it's null. */
  roomId: RoomId | null;
  me: Me;
  picked: LibraryFile | null;
  onPick: (file: LibraryFile) => void;
  onFailed: (error: unknown) => void;
}

/**
 * A list of files already in Ember to pick one of, with a search of their names: a conversation's, or every
 * file you can see. Room tabs and folders pick a file sent in their room with it; a composer can offer files
 * already in Ember with it too.
 */
export function FilePicker({ roomId, me, picked, onPick, onFailed }: FilePickerProps) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null);
  const [q, setQ] = useState("");
  const people = useContext(PeopleContext);
  useEffect(() => {
    let stopped = false;
    (roomId === null ? fetchFiles() : fetchRoomLibrary(roomId)).then(
      ({ files }) => !stopped && setFiles(files.filter((file) => file.kind === "file")),
      (error: unknown) => (!stopped || isSignedOut(error)) && onFailed(error),
    );
    return () => void (stopped = true);
  }, [roomId, onFailed]);
  const shown = useMemo(() => (files ? listFiles(files, { ...NO_FILE_FILTERS, q }, "newest", me.id) : []), [files, q, me.id]);
  return (
    <div className="grid gap-2">
      <FileSearch value={q} onChange={setQ} label="Search files" />
      <ul role="listbox" aria-label="Files" className="max-h-72 overflow-y-auto rounded-lg border p-1">
        {files === null ? (
          <li className="p-3 text-sm text-muted-foreground">Loading…</li>
        ) : shown.length === 0 ? (
          <li className="p-3 text-sm text-muted-foreground">{files.length === 0 ? "No files have been sent here yet." : "No files found."}</li>
        ) : (
          shown.map((file) => (
            <li
              key={file.id}
              role="option"
              aria-selected={picked?.id === file.id}
              tabIndex={0}
              onClick={() => onPick(file)}
              onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && (event.preventDefault(), onPick(file))}
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 outline-none hover:bg-hover focus-visible:bg-hover aria-selected:bg-hover aria-selected:ring-1 aria-selected:ring-foreground"
            >
              <FileTypeIcon file={file} className="size-8" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{file.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {people.get(file.owner.id)?.name ?? file.owner.name} · {dateLabel(new Date(file.createdAt))}
                </p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Edit tabs: rename each tab the members added, move it, or remove it, saved together with Save. */
export function EditTabsDialog({ room, tabs, onClose, onSaved, onFailed }: { room: Room; tabs: RoomTab[]; onClose: () => void; onSaved: (tabs: RoomTab[]) => void; onFailed: (error: unknown) => void }) {
  const [rows, setRows] = useState(() => tabs.map((tab) => ({ tab, title: tab.title, removed: false })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const move = (index: number, by: number) =>
    setRows((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row!);
      return next;
    });
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      for (const { tab, removed } of rows) if (removed) await removeTab(room.id, tab.id);
      const kept = rows.filter(({ removed }) => !removed);
      for (const { tab, title } of kept) if (title.trim() && title.trim() !== tab.title) await renameTab(room.id, tab.id, title.trim());
      const order = kept.map(({ tab }) => tab.id);
      onSaved(order.length > 0 ? await orderTabs(room.id, order) : []);
      onClose();
    } catch (failure) {
      setSaving(false);
      if (failure instanceof Error && !isSignedOut(failure)) setError(failure.message);
      else onFailed(failure);
    }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[520px] gap-4">
        <DialogTitle className="text-xl font-bold">Edit tabs</DialogTitle>
        <DialogDescription>Messages and Files & links always come first.</DialogDescription>
        <ul className="grid gap-2">
          {rows.map(({ tab, title, removed }, index) => {
            const Icon = TAB_ICONS[tab.kind];
            return (
              <li key={tab.id} className={cn("flex items-center gap-2", removed && "opacity-50")}>
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <input
                  aria-label={`Name of ${tab.title}`}
                  value={title}
                  disabled={removed}
                  maxLength={MAX_TAB_TITLE_LENGTH}
                  onChange={(event) => setRows((rows) => rows.map((row, at) => (at === index ? { ...row, title: event.target.value } : row)))}
                  className={cn(FIELD, "h-9 flex-1")}
                />
                <IconButton label={`Move ${tab.title} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                  <ArrowUp />
                </IconButton>
                <IconButton label={`Move ${tab.title} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                  <ArrowDown />
                </IconButton>
                <IconButton label={removed ? `Keep ${tab.title}` : `Remove ${tab.title}`} pressed={removed} onClick={() => setRows((rows) => rows.map((row, at) => (at === index ? { ...row, removed: !removed } : row)))}>
                  <Trash />
                </IconButton>
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconButton({ label, onClick, disabled, pressed, children }: { label: string; onClick: () => void; disabled?: boolean; pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 aria-pressed:bg-hover aria-pressed:text-foreground touch:size-11 [&>svg]:size-4"
    >
      {children}
    </button>
  );
}
