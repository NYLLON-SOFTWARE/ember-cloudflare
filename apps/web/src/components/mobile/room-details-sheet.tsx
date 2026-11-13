import { useContext, useRef, useState, type ComponentType, type MouseEvent, type ReactNode } from "react";
import type { Involvement, Room } from "@ember/protocol";
import type { RoomTab } from "@ember/protocol/library";
import { ChatLines, CheckCircleSolid, Group, Link, MultiplePages, Plus, Search, Settings, User as UserIcon, type IconoirIconProps } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { usePush } from "@/hooks/use-push";
import { openOverlay, personPath, roomSettingsPath, SEARCHES_PATH } from "@/hooks/use-route";
import { setInvolvement } from "@/lib/api";
import { pushAllowed } from "@/lib/push";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "../workspace/favorite-button";
import { BELLS } from "../workspace/involvement-button";
import { NotificationBell } from "../workspace/notification-bell";
import type { RoomHeaderProps } from "../workspace/room-header";
import { RarePage } from "../workspace/rare-pages";
import { TAB_ICONS, type ShownTab } from "../workspace/room-tab-icons";
import { ADDABLE, RoomTabsContext } from "../workspace/room-tabs";
import { OpenSearchContext, opensSearch } from "../workspace/search-box";
import { ActionSheet, BottomSheet, ROW } from "./action-sheet";
import { personOfDirect } from "./direct-person";

interface Props extends RoomHeaderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** A row's icon, where the sheet's rows have theirs. */
const ICON = "grid size-6 shrink-0 place-items-center text-muted-foreground [&>svg]:size-5";

/**
 * A row around one of a room's own controls, the star or the bell, which keep what
 * they do and say to screen readers: the control covers the row, its icon where a row's goes, and the
 * row's text, which it covers, says what it is to the eye.
 */
const CONTROL_ROW = cn(
  ROW,
  "relative [&>span:has(>button)]:contents",
  // What a control says when it fails, such as a star that couldn't be saved, on a line of its own under it.
  // The control covers the row's first 52px, and its note starts below that: 10px padding, 24px label, 12px gap and 6px.
  "flex-wrap [&_[role=status]:not(.sr-only)]:static [&_[role=status]:not(.sr-only)]:order-last [&_[role=status]:not(.sr-only)]:mt-1.5 [&_[role=status]:not(.sr-only)]:w-full [&_[role=status]:not(.sr-only)]:border-0 [&_[role=status]:not(.sr-only)]:bg-transparent [&_[role=status]:not(.sr-only)]:p-0 [&_[role=status]:not(.sr-only)]:pl-9 [&_[role=status]:not(.sr-only)]:text-negative [&_[role=status]:not(.sr-only)]:shadow-none",
  "[&>button]:absolute [&>button]:inset-x-0 [&>button]:top-0 [&>span>button]:absolute [&>span>button]:inset-x-0 [&>span>button]:top-0",
  "[&_button:first-child]:flex [&_button:first-child]:h-13 [&_button:first-child]:w-full [&_button:first-child]:items-center [&_button:first-child]:justify-start [&_button:first-child]:gap-3",
  "[&_button:first-child]:rounded-xl [&_button:first-child]:px-[18px] [&_button:first-child]:text-base [&_button:first-child]:font-normal [&_button:first-child]:text-muted-foreground [&_button:first-child>svg]:size-5",
);

/**
 * A phone's room details, after Slack's: the sheet the top bar's pill opens, with the room's tabs, Messages,
 * Files & links and those its members added, to show one or add one, then the star, the bell, who's in it,
 * Search in it and its settings, which the top bar has no room for. A DM with one person has their profile
 * in place of its members, and neither has a star.
 */
export function RoomDetailsSheet({ open, onOpenChange, room, me, name, present, favorite, onStarred, involvement, askForRoom, onSessionChanged, onFailed }: Props) {
  const tabs = useContext(RoomTabsContext);
  const openSearch = useContext(OpenSearchContext);
  const { on } = usePush();
  const Bell = BELLS[involvement];
  const [adding, setAdding] = useState(false);
  const [pickingLevel, setPickingLevel] = useState(false);
  const [membersShown, setMembersShown] = useState(false);
  const closeMembers = useRef(() => {});
  // Whether what was picked takes focus itself, as the search box and Add a tab do, rather than the pill getting it back.
  const handedOver = useRef(false);
  const direct = room.kind === "direct";
  const person = personOfDirect(room, me.id);
  const close = () => onOpenChange(false);
  const handOver = () => {
    handedOver.current = true;
    close();
  };
  const show = (tab: ShownTab) => {
    close();
    tabs?.show(tab);
  };
  const searchHere = (event: MouseEvent<HTMLAnchorElement>) => {
    handOver();
    opensSearch(openSearch, { roomId: room.id })(event);
  };

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={name}
        description={`Details of ${direct ? "this DM" : "this room"}`}
        onCloseAutoFocus={(event) => {
          if (handedOver.current) event.preventDefault();
          handedOver.current = false;
        }}
      >
        {tabs && !tabs.deleted && (
          <>
            <ul aria-label="Tabs" className="contents">
              <TabRow label="Messages" Icon={ChatLines} selected={tabs.shown === "messages"} onSelect={() => show("messages")} />
              <TabRow label="Files & links" Icon={MultiplePages} selected={tabs.shown === "files"} onSelect={() => show("files")} />
              {tabs.tabs.map((tab) => (
                <CustomTabRow key={tab.id} tab={tab} selected={tabs.shown === tab.id} onShow={() => show(tab.id)} onOpened={close} />
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    handOver();
                    setAdding(true);
                  }}
                  className={ROW}
                >
                  <span className={ICON}>
                    <Plus />
                  </span>
                  Add a tab
                </button>
              </li>
            </ul>
            <hr className="mx-4 my-1 border-t" />
          </>
        )}
        {!direct && (
          <div className={CONTROL_ROW}>
            <FavoriteButton roomId={room.id} favorite={favorite} onSaved={onStarred} onSessionChanged={onSessionChanged} />
            <Label>{favorite ? "Unstar" : "Star"}</Label>
          </div>
        )}
        {/* Your level in the room is the server's, so it's yours to pick whether or not this phone can have
            notifications, which a row of its own turns on where it can. */}
        <button
          type="button"
          onClick={() => {
            handOver();
            setPickingLevel(true);
          }}
          aria-description={LEVEL_NAMES[involvement]}
          className={ROW}
        >
          <span className={ICON}>
            <Bell />
          </span>
          <span className="min-w-0 flex-1 truncate">Notifications</span>
          <span aria-hidden="true" className="shrink-0 text-muted-foreground">
            {LEVEL_NAMES[involvement]}
          </span>
        </button>
        {!on && pushAllowed() && (
          <div className={CONTROL_ROW}>
            <NotificationBell room={room} involvement={involvement} askForRoom={askForRoom} onFailed={onFailed} />
            <Label>Enable notifications</Label>
          </div>
        )}
        {person ? (
          <PageLink href={personPath(person.id)} onClick={close} className={cn(ROW, "text-foreground no-underline")}>
            <span className={ICON}>
              <UserIcon />
            </span>
            View profile
          </PageLink>
        ) : (
          // A page of its own, over the room, as Slack's is, which Back closes.
          <button
            type="button"
            onClick={() => {
              handOver();
              setMembersShown(true);
              // Back, the page's or the phone's, goes back to the details, where Members was.
              closeMembers.current = openOverlay(() => {
                setMembersShown(false);
                onOpenChange(true);
              });
            }}
            className={ROW}
          >
            <span className={ICON}>
              <Group />
            </span>
            Members
          </button>
        )}
        <PageLink href={SEARCHES_PATH} onClick={searchHere} className={cn(ROW, "text-foreground no-underline")}>
          <span className={ICON}>
            <Search />
          </span>
          Search in conversation
        </PageLink>
        <PageLink href={roomSettingsPath(room.kind, room.id)} onClick={close} className={cn(ROW, "text-foreground no-underline")}>
          <span className={ICON}>
            <Settings />
          </span>
          Settings
        </PageLink>
      </BottomSheet>
      {/* Picking a level, or putting the levels away, goes back to the room's details, where they came from. */}
      {membersShown && (
        // Choosing someone goes to their profile, from the room it's over.
        <div className="fixed inset-0 z-40 bg-background" onClick={(event) => (event.target as Element).closest("a[href]") && setMembersShown(false)}>
          <RarePage show={({ MembersPage }) => <MembersPage room={room} me={me} present={present} onBack={() => closeMembers.current()} onFailed={onFailed} />} loading={null} />
        </div>
      )}
      <LevelSheet
        open={pickingLevel}
        onOpenChange={(open) => {
          setPickingLevel(open);
          if (!open) onOpenChange(true);
        }}
        room={room}
        involvement={involvement}
        askForRoom={askForRoom}
        onFailed={onFailed}
      />
      {tabs && (
        <ActionSheet
          open={adding}
          onOpenChange={setAdding}
          title="Add a tab"
          actions={ADDABLE.map(({ kind, label }) => {
            const Icon = TAB_ICONS[kind];
            return { label, icon: <Icon className="size-5" />, onSelect: () => tabs.add(kind) };
          })}
          more={tabs.tabs.length > 0 ? [{ label: "Edit tabs", onSelect: tabs.edit }] : []}
        />
      )}
    </>
  );
}

/** What a control's row says, after the control's own icon, which the control covers, so a tap anywhere on it is the control's. */
function Label({ children }: { children: ReactNode }) {
  return (
    <span aria-hidden="true" className="pointer-events-none flex min-w-0 items-center gap-3">
      <span className={ICON} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function TabRow({ label, Icon, selected, onSelect }: { label: string; Icon: ComponentType<IconoirIconProps>; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button type="button" aria-current={selected || undefined} onClick={onSelect} className={ROW}>
        <span className={ICON}>
          <Icon />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {selected && <CheckCircleSolid className="size-5 shrink-0" />}
      </button>
    </li>
  );
}

/** A tab the room's members added, which shows over the messages, or for a link, opens its address in a new browser tab. */
function CustomTabRow({ tab, selected, onShow, onOpened }: { tab: RoomTab; selected: boolean; onShow: () => void; onOpened: () => void }) {
  if (tab.kind !== "link") return <TabRow label={tab.title} Icon={TAB_ICONS[tab.kind]} selected={selected} onSelect={onShow} />;
  return (
    <li>
      <a href={tab.url} target="_blank" rel="noopener noreferrer" onClick={onOpened} className={cn(ROW, "text-foreground no-underline")}>
        <span className={ICON}>
          <Link />
        </span>
        <span className="min-w-0 flex-1 truncate">{tab.title}</span>
      </a>
    </li>
  );
}

/** Each level's name in the details' Notifications row and its sheet. */
const LEVEL_NAMES: Record<Involvement, string> = {
  everything: "All messages",
  mentions: "@ mentions",
  nothing: "Off",
  invisible: "Off and hidden",
};

/** The levels a room offers, as Slack lists them, all first, and a DM's, which has no mentions to single out nor a sidebar to hide from. */
const ROOM_LEVELS: Involvement[] = ["everything", "mentions", "nothing", "invisible"];
const DIRECT_LEVELS: Involvement[] = ["everything", "nothing"];

interface LevelSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: Room;
  involvement: Involvement;
  askForRoom: RoomHeaderProps["askForRoom"];
  onFailed: RoomHeaderProps["onFailed"];
}

/** Your level in a room, to pick one of, the one it is ticked; picking one saves it and closes the sheet. */
function LevelSheet({ open, onOpenChange, room, involvement, askForRoom, onFailed }: LevelSheetProps) {
  const [saving, setSaving] = useState(false);
  const pick = async (level: Involvement) => {
    if (saving) return;
    if (level === involvement) return onOpenChange(false);
    setSaving(true);
    const answered = askForRoom();
    try {
      answered({ type: "involved", roomId: room.id, involvement: await setInvolvement(room.id, level) });
      onOpenChange(false);
    } catch (error) {
      onFailed(error);
    } finally {
      setSaving(false);
    }
  };
  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Notifications">
      <div role="radiogroup" aria-label="Notifications" aria-busy={saving || undefined} className="contents">
        {(room.kind === "direct" ? DIRECT_LEVELS : ROOM_LEVELS).map((level) => {
          const Icon = BELLS[level];
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={level === involvement}
              aria-disabled={saving || undefined}
              onClick={() => void pick(level)}
              className={cn(ROW, "aria-disabled:opacity-50")}
            >
              <span className={ICON}>
                <Icon />
              </span>
              <span className="min-w-0 flex-1 truncate">{LEVEL_NAMES[level]}</span>
              {level === involvement && <CheckCircleSolid className="size-5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
