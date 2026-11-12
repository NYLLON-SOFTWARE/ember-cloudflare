import { useCallback, useMemo, useState } from "react";
import type { FilesPlace, Me, Room } from "@ember/protocol";
import { filtersOn, listFiles, NO_FILE_FILTERS, type FileFilters, type FileOwner, type FileSort, type LibraryFile } from "@ember/protocol/library";
import { MainContent } from "@/components/main-content";
import { fileOpened, starFile, useFiles } from "@/hooks/use-files";
import { useTitle } from "@/hooks/use-title";
import { cn } from "@/lib/utils";
import { CONTROLS_ROW, FileRow, FileSearch, FilterButton, FilterDialog, LIST_CHIPS, NothingHere, SortMenu, TypesMenu } from "./file-list";
import { PageHeader } from "./page-header";
import { Chip, useSearchNames } from "./search-box";

/** What each place on the Files page is called. */
export const PLACE_TITLES: Record<FilesPlace, string> = { all: "All files", canvases: "Canvases", starred: "Starred" };

const OWNERS: Array<{ owner: FileOwner; label: string }> = [
  { owner: "all", label: "All" },
  { owner: "mine", label: "Created by you" },
  { owner: "shared", label: "Shared with you" },
];

interface Props {
  me: Me;
  place: FilesPlace;
  /** The rooms the sidebar lists, which name each file's conversation and which "In" offers. */
  rooms: readonly Room[];
  onFailed: (error: unknown) => void;
}

/** What an empty list says: that nothing matches what's searched for, or else what there's none of yet. */
function emptyTitle(place: FilesPlace, filters: FileFilters, files: LibraryFile[]): string {
  if (filters.q.trim() !== "" || filters.types.length > 0 || filtersOn(filters) > 0) return "No matches";
  if (place === "starred") return "No starred files";
  if (filters.owner === "mine") return place === "canvases" ? "You haven’t made any canvases yet" : "You haven’t shared any files yet";
  if (filters.owner === "shared") return place === "canvases" ? "Nobody has shared a canvas with you yet" : "Nobody has shared a file with you yet";
  return files.length === 0 || place !== "canvases" ? "No files yet" : "No canvases yet";
}

/**
 * The Files page, after Slack's: the files and canvases in every conversation you're in, or only the
 * canvases, or the files you've starred, with a search of their names, All, Created by you and Shared with
 * you, the kinds of file to show, Filter by (from whom, where and when), and their order, Recently viewed
 * first unless another's picked. Each row opens its file, stars it, downloads it, or goes to its message.
 */
export function FilesPage({ me, place, rooms, onFailed }: Props) {
  const { files, failed } = useFiles(onFailed);
  const names = useSearchNames(me, rooms);
  const [filters, setFilters] = useState<FileFilters>(NO_FILE_FILTERS);
  const [sort, setSort] = useState<FileSort>("viewed");
  const [filtering, setFiltering] = useState(false);
  useTitle(PLACE_TITLES[place]);
  const placed = useMemo<FileFilters>(() => ({ ...filters, starred: place === "starred", canvases: place === "canvases" }), [filters, place]);
  const shown = useMemo(() => (files ? listFiles(files, placed, sort, me.id) : null), [files, placed, sort, me.id]);
  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms]);
  const star = useCallback((file: LibraryFile, starred: boolean) => void starFile(file, starred, onFailed), [onFailed]);

  return (
    <>
      <PageHeader>
        <h1 className="min-w-0 flex-1 truncate text-[17px] leading-[1.4] font-[650] max-md:text-base">{PLACE_TITLES[place]}</h1>
      </PageHeader>
      <MainContent
        aria-busy={files === null && !failed ? true : undefined}
        className="relative flex min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain bg-background pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]"
      >
        <div className="flex w-full max-w-[1040px] flex-col gap-3 px-[22px] pt-5 pb-[max(18px,env(safe-area-inset-bottom))] narrow:px-[18px] max-md:px-3 max-md:pt-3">
          <FileSearch value={filters.q} onChange={(q) => setFilters({ ...filters, q })} label={place === "canvases" ? "Search canvases" : "Search files"} />
          <div className={CONTROLS_ROW}>
            <div role="group" aria-label="Whose files" className={LIST_CHIPS}>
              {OWNERS.map(({ owner, label }) => (
                <Chip key={owner} pressed={filters.owner === owner} onClick={() => setFilters({ ...filters, owner })}>
                  {label}
                </Chip>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {place !== "canvases" && <TypesMenu types={filters.types} onChange={(types) => setFilters({ ...filters, types })} />}
              <SortMenu sort={sort} onSort={setSort} />
              <FilterButton filters={filters} onClick={() => setFiltering(true)} />
            </div>
          </div>
          <FilterDialog
            open={filtering}
            onOpenChange={setFiltering}
            me={me}
            filters={filters}
            rooms={rooms}
            names={names}
            onApply={({ from, in: inRoom, date }) => setFilters({ ...filters, from, in: inRoom, date })}
            onClear={() => setFilters({ ...NO_FILE_FILTERS, q: filters.q })}
          />
          {shown === null ? (
            failed ? (
              <NothingHere title="Files couldn’t load" />
            ) : null
          ) : shown.length === 0 ? (
            <NothingHere title={emptyTitle(place, filters, files!)} />
          ) : (
            <ul aria-label={PLACE_TITLES[place]} className="-mx-3 flex flex-col">
              {shown.map((file) => (
                <FileRow key={file.id} file={file} room={roomsById.get(file.roomId) ?? null} names={names} showRoom sort={sort} onOpened={fileOpened} onStar={star} />
              ))}
            </ul>
          )}
        </div>
      </MainContent>
    </>
  );
}
