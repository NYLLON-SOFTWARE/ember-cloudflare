import { createContext, lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type Dispatch, type KeyboardEvent, type SetStateAction, type WheelEvent } from "react";
import type { Me } from "@ember/protocol";
import type { RoomTab, RoomTabKind } from "@ember/protocol/library";
import { ChatLines, Link, MultiplePages, Plus, type IconoirIconProps } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { navigate, useQuery } from "@/hooks/use-route";
import type { Room } from "@/lib/api";
import { fetchTabs } from "@/lib/library";
import { cn } from "@/lib/utils";
import { TAB_ICONS, type ShownTab } from "./room-tab-icons";

// The tabs over a room's messages, after Slack's channel tabs: Messages, Files & links, and the tabs the
// room's members add: a file, a link, a folder of files and links, or a canvas. What a tab other than
// Messages shows covers the timeline and composer, which stay as they are underneath (room-tab-panels.tsx).

const RoomTabPanel = lazy(() => import("./pages").then(({ RoomTabPanel }) => ({ default: RoomTabPanel })));
const AddTabDialog = lazy(() => import("./pages").then(({ AddTabDialog }) => ({ default: AddTabDialog })));
const EditTabsDialog = lazy(() => import("./pages").then(({ EditTabsDialog }) => ({ default: EditTabsDialog })));


/** What the + menu adds. */
const ADDABLE: Array<{ kind: RoomTabKind; label: string }> = [
  { kind: "file", label: "File" },
  { kind: "link", label: "Link" },
  { kind: "folder", label: "Folder" },
  { kind: "canvas", label: "Canvas" },
];

const TAB =
  "relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 text-[14px] font-medium text-muted-foreground hover:text-foreground aria-selected:text-foreground aria-selected:after:absolute aria-selected:after:inset-x-1.5 aria-selected:after:bottom-0 aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-foreground touch:min-h-11 [&>svg]:size-4 [&>svg]:shrink-0";

/** Which ends of the strip have tabs past them. */
type Overflow = "none" | "before" | "after" | "both";

const OVERFLOW_FADES: Record<Overflow, string> = {
  none: "",
  before: "[mask-image:linear-gradient(to_right,transparent,#000_32px)]",
  after: "[mask-image:linear-gradient(to_left,transparent,#000_32px)]",
  both: "[mask-image:linear-gradient(to_right,transparent,#000_32px,#000_calc(100%-32px),transparent)]",
};

/** An item in the + menu, as a dropdown menu's items look. */
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-hover focus-visible:bg-hover touch:min-h-11";

/**
 * A room's tabs, which shows, and what changes them: what the strip draws, and what a phone's tab sheet
 * can draw in its place. A room's view makes it, with `useRoomTabs`, and gives it to both, the sheet
 * through `RoomTabsContext`.
 */
export interface RoomTabsState {
  /** The tabs the room's members added, in order. */
  tabs: RoomTab[];
  /** The tab shown: Messages, Files & links, or one of `tabs`, by id. Always Messages in a room that's gone. */
  shown: ShownTab;
  /** Shows a tab, going to its address. A link tab isn't shown, but opens its address in a new browser tab. */
  show: (tab: ShownTab) => void;
  /** Opens the dialog that adds a tab of `kind`. */
  add: (kind: RoomTabKind) => void;
  /** Opens Edit tabs, while there are tabs to edit. */
  edit: () => void;
  /** Whether the room is gone, which leaves it no tabs to show or add. */
  deleted: boolean;
  adding: RoomTabKind | null;
  editing: boolean;
  /** For the strip's dialogs: closing them, and what they change. */
  closeDialogs: () => void;
  setTabs: Dispatch<SetStateAction<RoomTab[]>>;
  reload: () => void;
}

/** The tabs of room `room`, as its view keeps them; `deleted` says whether the room is gone. */
export function useRoomTabs(room: Room, deleted: boolean, onFailed: (error: unknown) => void): RoomTabsState {
  const [tabs, setTabs] = useState<RoomTab[]>([]);
  const addressed = useShownTab();
  const [adding, setAdding] = useState<RoomTabKind | null>(null);
  const [editing, setEditing] = useState(false);
  const reload = useCallback(() => {
    if (!deleted) fetchTabs(room.id).then(setTabs, onFailed);
  }, [room.id, deleted, onFailed]);
  useEffect(reload, [reload]);
  // A room that's gone has no tabs, so its address names none.
  const gone = deleted && addressed !== "messages";
  useEffect(() => {
    if (gone) navigate(addressShowing("messages"), { replace: true });
  }, [gone]);
  return {
    tabs: deleted ? [] : tabs,
    shown: deleted ? "messages" : addressed,
    show: (tab) => navigate(addressShowing(tab)),
    add: setAdding,
    edit: () => setEditing(true),
    deleted,
    adding: deleted ? null : adding,
    editing: !deleted && editing,
    closeDialogs: () => {
      setAdding(null);
      setEditing(false);
    },
    setTabs,
    reload,
  };
}

/** The tabs of the room shown, for a phone's tab sheet, or null outside a room. */
export const RoomTabsContext = createContext<RoomTabsState | null>(null);

interface Props {
  room: Room;
  me: Me;
  /** The room's tabs, from `useRoomTabs`. */
  state: RoomTabsState;
  /** Says why tabs couldn't load or change, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The room's tab strip, first in its main content, and the tab shown under it. The address names the tab
 * shown: a room's address with `?tab=files`, or a tab's id, opens that tab, as the Files page's canvases do,
 * and picking one goes to its address. A link tab opens its address in a new browser tab rather than
 * showing in place.
 */
export function RoomTabs({ room, me, state, onFailed }: Props) {
  const { tabs, shown, deleted, adding, editing, setTabs, reload } = state;
  const [menuOpen, setMenuOpen] = useState(false);
  /** Closes the + menu, then does what was picked in it. */
  const pick = (act: () => void) => {
    setMenuOpen(false);
    act();
  };
  const strip = useRef<HTMLDivElement>(null);
  // Tabs past either end of the strip fade out there, so it shows there's more to scroll to.
  const list = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<Overflow>("none");
  const measure = useCallback(() => {
    const element = list.current;
    if (!element) return;
    const before = element.scrollLeft > 1;
    const after = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setOverflow(before && after ? "both" : before ? "before" : after ? "after" : "none");
  }, []);
  useLayoutEffect(() => {
    measure();
    const element = list.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measure, tabs]);

  // What the shown tab covers can't be reached until Messages shows again. A room that's gone shows its
  // messages, as they were, and nothing else.
  const covering = shown !== "messages";
  useLayoutEffect(() => {
    const wrapper = strip.current?.parentElement;
    if (!wrapper) return;
    for (let sibling = wrapper.nextElementSibling; sibling; sibling = sibling.nextElementSibling) (sibling as HTMLElement).inert = covering;
  }, [covering]);

  const custom = tabs.find((tab) => tab.id === shown);
  const select = state.show;
  /** Shows Messages in place of a tab that's gone, as if it had never been. */
  const leaveGoneTab = () => navigate(addressShowing("messages"), { replace: true });
  const added = (tab: RoomTab) => {
    setTabs((tabs) => [...tabs.filter((other) => other.id !== tab.id), tab]);
    if (tab.kind !== "link") select(tab.id);
  };

  // A wheel that only scrolls up and down scrolls the tabs sideways.
  const scrollSideways = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) event.currentTarget.scrollLeft += event.deltaY;
  };

  // Arrow keys move along the tabs, as a tablist's do.
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const all = [...(strip.current?.querySelectorAll<HTMLElement>("[role=tab]") ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    all[(at + (event.key === "ArrowRight" ? 1 : all.length - 1)) % all.length]?.focus();
  };

  return (
    <div className="contents">
      {/* The tabs scroll sideways, with a mouse's wheel too, while + stays at the end of the strip, in reach. */}
      <div ref={strip} className="flex h-10 flex-none items-end gap-0.5 border-b bg-background pr-[14px] max-md:pr-1.5">
        <div
          ref={list}
          role="tablist"
          aria-label="Room tabs"
          onKeyDown={moveFocus}
          onWheel={scrollSideways}
          onScroll={measure}
          className={cn("flex h-full min-w-0 items-end gap-0.5 overflow-x-auto pl-[14px] [scrollbar-width:none] max-md:pl-1.5", OVERFLOW_FADES[overflow])}
        >
          <StripTab label="Messages" Icon={ChatLines} selected={!covering} onSelect={() => select("messages")} />
          {!deleted && <StripTab label="Files & links" Icon={MultiplePages} selected={shown === "files"} onSelect={() => select("files")} />}
          {!deleted &&
            tabs.map((tab) =>
              tab.kind === "link" ? (
                <a key={tab.id} href={tab.url} target="_blank" rel="noopener noreferrer" title={tab.url} className={TAB}>
                  <Link />
                  <span className="max-w-[16em] truncate">{tab.title}</span>
                </a>
              ) : (
                <StripTab key={tab.id} label={tab.title} Icon={TAB_ICONS[tab.kind]} selected={shown === tab.id} onSelect={() => select(tab.id)} />
              ),
            )}
        </div>
        <Popover open={menuOpen && !deleted} onOpenChange={setMenuOpen}>
          <PopoverTrigger hidden={deleted} title="Add a tab" className="mb-1.5 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover touch:size-11">
            <Plus className="size-4" />
            <span className="sr-only">Add a tab</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-1">
            {ADDABLE.map(({ kind, label }) => {
              const Icon = TAB_ICONS[kind];
              return (
                <button key={kind} type="button" onClick={() => pick(() => state.add(kind))} className={MENU_ITEM}>
                  <Icon className="size-4" />
                  {label}
                </button>
              );
            })}
            {tabs.length > 0 && (
              <>
                <hr className="-mx-1 my-1 border-t" />
                <button type="button" onClick={() => pick(state.edit)} className={MENU_ITEM}>
                  Edit tabs
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {covering && (
        <section
          role="tabpanel"
          aria-label={shown === "files" ? "Files & links" : (custom?.title ?? "Tab")}
          className="absolute inset-x-0 top-10 bottom-0 z-[5] flex min-h-0 flex-col bg-background"
        >
          <Suspense fallback={null}>
            <RoomTabPanel
              key={shown}
              room={room}
              me={me}
              shown={shown}
              tab={custom ?? null}
              onTabChanged={(tab) => setTabs((tabs) => tabs.map((other) => (other.id === tab.id ? tab : other)))}
              onTabGone={() => {
                leaveGoneTab();
                reload();
              }}
              onFailed={onFailed}
            />
          </Suspense>
        </section>
      )}
      {adding && (
        <Suspense fallback={null}>
          <AddTabDialog room={room} me={me} kind={adding} onClose={state.closeDialogs} onAdded={added} onFailed={onFailed} />
        </Suspense>
      )}
      {editing && (
        <Suspense fallback={null}>
          <EditTabsDialog
            room={room}
            tabs={tabs}
            onClose={state.closeDialogs}
            onSaved={(next) => {
              setTabs(next);
              if (shown !== "messages" && shown !== "files" && !next.some((tab) => tab.id === shown)) leaveGoneTab();
            }}
            onFailed={onFailed}
          />
        </Suspense>
      )}
    </div>
  );
}

/** The tab the address shows: its query's `tab`, `files` or a tab's id, or Messages without one. */
function useShownTab(): ShownTab {
  return new URLSearchParams(useQuery()).get("tab") || "messages";
}

/**
 * The address of the page shown, but showing `tab` in its room: Messages leaves `tab` out, so a room's own
 * link shows its messages. Each tab is an entry in the history, for Back and Forward, and a reload keeps it.
 */
function addressShowing(tab: ShownTab): string {
  const query = new URLSearchParams(location.search);
  if (tab === "messages") query.delete("tab");
  else query.set("tab", tab);
  const search = query.toString();
  return location.pathname + (search ? `?${search}` : "");
}

function StripTab({ label, Icon, selected, onSelect }: { label: string; Icon: ComponentType<IconoirIconProps>; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={onSelect} className={cn(TAB)}>
      <Icon />
      <span className="max-w-[16em] truncate">{label}</span>
    </button>
  );
}
