import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
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

/** An item in the + menu, as a dropdown menu's items look. */
const MENU_ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-hover focus-visible:bg-hover touch:min-h-11";

interface Props {
  room: Room;
  me: Me;
  /** Says why tabs couldn't load or change, as the workspace's alerts do. */
  onFailed: (error: unknown) => void;
}

/**
 * The room's tab strip, first in its main content, and the tab shown under it. The address names the tab
 * shown: a room's address with `?tab=files`, or a tab's id, opens that tab, as the Files page's canvases do,
 * and picking one goes to its address. A link tab opens its address in a new browser tab rather than
 * showing in place.
 */
export function RoomTabs({ room, me, onFailed }: Props) {
  const [tabs, setTabs] = useState<RoomTab[]>([]);
  const shown = useShownTab();
  const [adding, setAdding] = useState<RoomTabKind | null>(null);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Closes the + menu, then does what was picked in it. */
  const pick = (act: () => void) => {
    setMenuOpen(false);
    act();
  };
  const strip = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    fetchTabs(room.id).then(setTabs, onFailed);
  }, [room.id, onFailed]);
  useEffect(reload, [reload]);

  // What the shown tab covers can't be reached until Messages shows again.
  const covering = shown !== "messages";
  useLayoutEffect(() => {
    const wrapper = strip.current?.parentElement;
    if (!wrapper) return;
    for (let sibling = wrapper.nextElementSibling; sibling; sibling = sibling.nextElementSibling) (sibling as HTMLElement).inert = covering;
  }, [covering]);

  const custom = tabs.find((tab) => tab.id === shown);
  const select = (tab: ShownTab) => navigate(addressShowing(tab));
  /** Shows Messages in place of a tab that's gone, as if it had never been. */
  const leaveGoneTab = () => navigate(addressShowing("messages"), { replace: true });
  const added = (tab: RoomTab) => {
    setTabs((tabs) => [...tabs.filter((other) => other.id !== tab.id), tab]);
    if (tab.kind !== "link") select(tab.id);
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
      <div
        ref={strip}
        role="tablist"
        aria-label="Room tabs"
        onKeyDown={moveFocus}
        className="flex h-10 flex-none items-end gap-0.5 overflow-x-auto border-b bg-background px-[14px] [scrollbar-width:none] max-md:px-1.5"
      >
        <StripTab label="Messages" Icon={ChatLines} selected={shown === "messages"} onSelect={() => select("messages")} />
        <StripTab label="Files & links" Icon={MultiplePages} selected={shown === "files"} onSelect={() => select("files")} />
        {tabs.map((tab) =>
          tab.kind === "link" ? (
            <a key={tab.id} href={tab.url} target="_blank" rel="noopener noreferrer" title={tab.url} className={TAB}>
              <Link />
              <span className="max-w-[16em] truncate">{tab.title}</span>
            </a>
          ) : (
            <StripTab key={tab.id} label={tab.title} Icon={TAB_ICONS[tab.kind]} selected={shown === tab.id} onSelect={() => select(tab.id)} />
          ),
        )}
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger title="Add a tab" className="mb-1.5 grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover touch:size-11">
            <Plus className="size-4" />
            <span className="sr-only">Add a tab</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-52 p-1">
            {ADDABLE.map(({ kind, label }) => {
              const Icon = TAB_ICONS[kind];
              return (
                <button key={kind} type="button" onClick={() => pick(() => setAdding(kind))} className={MENU_ITEM}>
                  <Icon className="size-4" />
                  {label}
                </button>
              );
            })}
            {tabs.length > 0 && (
              <>
                <hr className="-mx-1 my-1 border-t" />
                <button type="button" onClick={() => pick(() => setEditing(true))} className={MENU_ITEM}>
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
          <AddTabDialog room={room} me={me} kind={adding} onClose={() => setAdding(null)} onAdded={added} onFailed={onFailed} />
        </Suspense>
      )}
      {editing && (
        <Suspense fallback={null}>
          <EditTabsDialog
            room={room}
            tabs={tabs}
            onClose={() => setEditing(false)}
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
