import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { RoomIconName } from "@ember/protocol";
import { Dismiss, IconPickerChevron, IconPickerSearch } from "@/components/icons/ember";
import CATALOG_URL from "@/components/icons/lucide/catalog.json?url";
import { RoomIcon, roomIconLabel } from "@/components/icons/room-icon";
import { cn } from "@/lib/utils";

// ember-rust's room icon picker (rooms/layouts/_icon_picker.html), run as its
// crates/assets/overrides/controllers/icon_picker_controller.js runs it and styled by zz-ember.css
// (.mb-icon-picker, .mb-icon-dialog). The icon applied here is saved with the form. ember-rust offers
// a plain select without JavaScript, which the app can't run without.

interface CatalogIcon {
  name: RoomIconName;
  label: string;
  svg: string;
}

/** How many icons the grid shows at a time. */
const PAGE_SIZE = 72;
/** The icons listed first until something is searched for. */
const POPULAR: RoomIconName[] = ["hash", "messages-square", "bot", "code", "sparkles", "coffee", "rocket", "palette", "megaphone", "heart", "lightbulb", "music", "gamepad-2", "book-open", "camera", "calendar", "globe", "users", "flame", "leaf", "star", "wrench", "shield", "lock"];

// The catalog (991 KB) is fetched when a picker first opens, once for every picker on the page,
// and again next time if it fails.
const catalogs = new Map<string, Promise<CatalogIcon[]>>();

function loadCatalog(url: string): Promise<CatalogIcon[]> {
  let catalog = catalogs.get(url);
  if (!catalog) {
    catalog = fetch(url, { credentials: "same-origin" }).then((response) => {
      if (!response.ok) throw new Error("Icon catalog could not be loaded");
      return response.json() as Promise<CatalogIcon[]>;
    });
    catalog.catch(() => catalogs.delete(url));
    catalogs.set(url, catalog);
  }
  return catalog;
}

/** The icons whose name and label hold every word of `query`, split at spaces and hyphens; with none, popular ones first. */
function search(catalog: CatalogIcon[], query: string): CatalogIcon[] {
  const terms = query.trim().toLowerCase().split(/[\s-]+/).filter(Boolean);
  const matches = catalog.filter((icon) => terms.every((term) => `${icon.name} ${icon.label}`.toLowerCase().includes(term)));
  if (terms.length) return matches;
  const rank = (icon: CatalogIcon) => {
    const index = POPULAR.indexOf(icon.name);
    return index < 0 ? POPULAR.length : index;
  };
  return matches.sort((a, b) => rank(a) - rank(b));
}

/** What the results line says once the catalog is in. */
function resultsLabel(count: number, shown: number): string {
  if (!count) return "No icons match your search. Try another word.";
  return `${count.toLocaleString()} ${count === 1 ? "icon" : "icons"}${count > shown ? ` · ${shown} shown` : ""}`;
}

/** Campfire's `.btn` as ember-rust's zz-ember.css sets it, which no hover changes. */
const BUTTON = "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-[1.1em] py-[0.5em] font-medium text-foreground";
/** `.mb-icon-dialog-footer .btn`, 44px tall on touch screens, where ember-rust's are below 600px. */
const FOOTER_BUTTON = "min-h-10 px-3.5 py-2 touch:min-h-11";

interface Props {
  /** The icon the form saves, or null for `#`. */
  icon: RoomIconName | null;
  /** Called with the icon chosen when it's applied. */
  onChange: (icon: RoomIconName | null) => void;
  /** While the form saves, which sends the icon shown when Save was pressed. */
  disabled?: boolean;
  /** Where the catalog comes from. */
  catalogUrl?: string;
}

/**
 * The room's icon, with a button that opens a dialog of every icon in the catalog to search, page
 * through and pick from, by pointer or keyboard, before applying one or keeping the icon as it was.
 */
export function IconPicker({ icon, onChange, disabled = false, catalogUrl = CATALOG_URL }: Props) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  const browse = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  // Counts each opening and closing, so a catalog that arrives for a picker since closed is ignored.
  const opening = useRef(0);
  const [catalog, setCatalog] = useState<CatalogIcon[] | null>(null);
  const [status, setStatus] = useState<"loading" | "failed" | "ready">("loading");
  const [matches, setMatches] = useState<CatalogIcon[]>([]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  // The icon picked here, which Use icon applies.
  const [staged, setStaged] = useState<RoomIconName | null>(icon);
  // The icon the keyboard last moved to, which Tab reaches in the grid; until it moves, the staged
  // icon or the first.
  const [roving, setRoving] = useState<RoomIconName | null>(null);
  const focusing = useRef<RoomIconName | null>(null);

  const shown = matches.slice(0, visible);
  const tabStop = [roving, staged].find((name) => shown.some((icon) => icon.name === name)) ?? shown[0]?.name;

  // Show more icons focuses the first it adds, once it's drawn.
  useEffect(() => {
    if (!focusing.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-icon="${focusing.current}"]`)?.focus();
    focusing.current = null;
  }, [visible]);

  const find = (value: string, icons = catalog) => {
    if (!icons) return;
    setMatches(search(icons, value));
    setVisible(PAGE_SIZE);
    setRoving(null);
    if (browse.current) browse.current.scrollTop = 0;
  };

  const load = async () => {
    const ticket = ++opening.current;
    setStatus("loading");
    try {
      const icons = catalog ?? (await loadCatalog(catalogUrl));
      setCatalog(icons);
      if (ticket !== opening.current || !dialog.current?.open) return;
      setStatus("ready");
      find(searchBox.current?.value ?? "", icons);
    } catch {
      if (ticket !== opening.current || !dialog.current?.open) return;
      setStatus("failed");
    }
  };

  const open = () => {
    // Cleared here, as ember-rust's open() clears it, since the search reads the field itself: a
    // catalog already in is searched before React would draw the field again.
    if (searchBox.current) searchBox.current.value = "";
    setStaged(icon);
    dialog.current?.showModal();
    searchBox.current?.focus();
    if (browse.current) browse.current.scrollTop = 0;
    void load();
  };

  const cancel = () => {
    opening.current++;
    if (dialog.current?.open) dialog.current.close();
  };

  const apply = () => {
    onChange(staged);
    dialog.current?.close();
  };

  const more = () => {
    const next = matches[Math.min(visible, matches.length)];
    setVisible(visible + PAGE_SIZE);
    if (!next) return;
    setRoving(next.name);
    focusing.current = next.name;
  };

  // Arrows move by one, or by a row of however many columns the grid has, stopping at the ends.
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-icon]");
    if (!button || !grid.current) return;
    const buttons = [...grid.current.querySelectorAll<HTMLButtonElement>("button[data-icon]")];
    const columns = getComputedStyle(grid.current).gridTemplateColumns.split(" ").length;
    const movement: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns };
    const index = buttons.indexOf(button);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else if (event.key in movement) next = Math.max(0, Math.min(buttons.length - 1, index + movement[event.key]!));
    else return;
    event.preventDefault();
    const target = buttons[next]!;
    setRoving(target.dataset.icon as RoomIconName);
    target.focus();
  };

  // A click on the backdrop, outside the dialog's box, closes it.
  const backdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target !== dialog.current) return;
    const box = dialog.current.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) cancel();
  };

  return (
    <div className="mt-[22px] flex min-w-0 flex-col gap-[7px] text-start">
      <div>
        <span className="flex items-center gap-2 text-[13px] font-[550]">Room icon</span>
        <button
          ref={trigger}
          type="button"
          aria-label="Choose room icon"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={open}
          className="flex min-h-[74px] w-full cursor-pointer items-center gap-[13px] rounded-[10px] border bg-background px-[15px] py-[13px] text-start text-foreground enabled:hover:border-muted-foreground enabled:hover:bg-surface disabled:cursor-not-allowed"
        >
          <RoomIcon icon={icon} size={23} className="flex size-[42px] flex-[0_0_42px] items-center justify-center rounded-[9px] bg-hover text-[26px] text-foreground" />
          <span className="grid min-w-0 flex-1 gap-[3px]">
            <strong className="text-sm font-medium wrap-anywhere">{roomIconLabel(icon)}</strong>
            <span className="text-xs text-muted-foreground">Choose from Lucide icons</span>
          </span>
          <IconPickerChevron className="size-[18px] flex-[0_0_18px] text-muted-foreground" />
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Shown beside this room for everyone in the workspace.</p>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          cancel();
        }}
        onClose={() => {
          opening.current++;
          trigger.current?.focus({ preventScroll: true });
        }}
        onClick={backdrop}
        className={cn(
          "m-auto w-[600px] overflow-hidden rounded-2xl border bg-background p-0 text-foreground shadow-[0_16px_60px_var(--color-dialog-shadow)] backdrop:bg-dialog-backdrop open:flex open:flex-col",
          // Centered in the safe area, clear of the notch and the home indicator, which ember-rust's isn't.
          "inset-[env(safe-area-inset-top)_env(safe-area-inset-right)_env(safe-area-inset-bottom)_env(safe-area-inset-left)]",
          "max-h-[min(720px,calc(100dvh-40px-env(safe-area-inset-top)-env(safe-area-inset-bottom)))] max-w-[calc(100dvw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))]",
          "max-[600px]:max-h-[calc(100dvh-24px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] max-[600px]:max-w-[calc(100dvw-24px-env(safe-area-inset-left)-env(safe-area-inset-right))]",
          "short:max-h-[calc(100dvh-16px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
        )}
      >
        <header className="flex flex-none items-start justify-between gap-4 px-6 pt-[23px] pb-[18px] max-[600px]:px-4 max-[600px]:pt-[18px] max-[600px]:pb-4 short:pt-3 short:pb-2">
          <div>
            <h2 id={titleId} className="mb-[5px] text-start text-[19px] font-semibold max-[600px]:text-[17px]">
              Choose a room icon
            </h2>
            <p className="text-[13px] text-muted-foreground">A little personality for your room.</p>
          </div>
          <button type="button" aria-label="Close icon picker" onClick={cancel} className="grid size-9 flex-none cursor-pointer place-items-center rounded-[9px] touch:size-11">
            <Dismiss className="size-5" />
          </button>
        </header>

        {/* A label, where ember-rust's is a box, so a tap anywhere on it reaches the field. */}
        <label className="mx-6 mb-4 flex flex-none cursor-text items-center gap-2.5 rounded-[9px] border px-3 py-2.5 focus-within:border-foreground focus-within:ring-1 focus-within:ring-foreground max-[600px]:mx-4 short:mb-2">
          <IconPickerSearch className="size-[18px] flex-[0_0_18px] text-muted-foreground" />
          <input
            ref={searchBox}
            type="search"
            placeholder="Search icons, e.g. coffee or rocket"
            aria-label="Search icons"
            autoComplete="off"
            data-ember-preserve-selection
            onChange={(event) => find(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              // Stages the first match without applying it, and doesn't send the form.
              event.preventDefault();
              if (matches[0]) setStaged(matches[0].name);
            }}
            className="w-full min-w-0 bg-transparent p-0 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none touch:text-base"
          />
        </label>

        {/* ember-rust keeps 150px of icons, which pushes the footer off a phone in landscape. */}
        <div ref={browse} className="min-h-[150px] flex-auto overflow-y-auto overscroll-contain px-6 pb-5 max-[600px]:px-4 short:min-h-0">
          <button
            type="button"
            aria-pressed={staged === null}
            onClick={() => setStaged(null)}
            className="group flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[9px] border bg-surface px-3 py-2.5 text-start text-foreground aria-pressed:border-foreground"
          >
            <span aria-hidden="true" className="w-[26px] text-center text-[23px] leading-none text-muted-foreground">
              #
            </span>
            <span>Use default icon</span>
            <span aria-hidden="true" className="ms-auto opacity-0 group-aria-pressed:opacity-100">
              ✓
            </span>
          </button>
          <p role="status" aria-live="polite" className="mt-[17px] mb-[11px] text-xs text-muted-foreground">
            {status === "loading" ? "Loading icons…" : status === "failed" ? "Icons couldn’t load. Try again; your current icon is unchanged." : resultsLabel(matches.length, shown.length)}
          </p>
          <div
            ref={grid}
            role="group"
            aria-label="Room icons"
            aria-busy={status === "loading" || undefined}
            onKeyDown={navigate}
            className="grid grid-cols-8 gap-1.5 max-[600px]:grid-cols-5 max-[600px]:gap-[5px]"
          >
            {shown.map((option) => (
              <button
                key={option.name}
                type="button"
                data-icon={option.name}
                title={option.label}
                tabIndex={option.name === tabStop ? 0 : -1}
                aria-label={`Use ${option.label} icon`}
                aria-pressed={option.name === staged}
                onClick={() => setStaged(option.name)}
                className="flex min-h-[66px] min-w-0 cursor-pointer flex-col items-center justify-center gap-[7px] rounded-[9px] border border-transparent bg-background px-[3px] pt-[9px] pb-[7px] text-foreground hover:bg-hover focus-visible:outline-offset-0 aria-pressed:border-foreground aria-pressed:bg-hover"
              >
                {/* The catalog's own markup, generated from Lucide and checked by catalog.test.ts, as ember-rust draws it. */}
                <span aria-hidden="true" className="flex [&>svg]:size-[23px]" dangerouslySetInnerHTML={{ __html: option.svg }} />
                <span className="w-full truncate text-[10px] leading-[1.2] text-muted-foreground">{option.label}</span>
              </button>
            ))}
          </div>
          {status === "ready" && shown.length < matches.length && (
            <button type="button" onClick={more} className={cn(BUTTON, "mt-4 w-full bg-surface p-[9px] text-[13px] touch:min-h-11")}>
              Show more icons
            </button>
          )}
          {status === "failed" && (
            <button type="button" onClick={() => void load()} className={cn(BUTTON, "mt-4 w-full bg-surface p-[9px] text-[13px] touch:min-h-11")}>
              Try again
            </button>
          )}
        </div>

        <footer className="flex flex-none items-center justify-between gap-4 border-t px-6 py-4 max-[600px]:flex-col max-[600px]:items-stretch max-[600px]:gap-[13px] max-[600px]:px-4 max-[600px]:py-3.5 short:py-2">
          <span className="flex min-w-0 items-center gap-2.5 text-xs">
            <RoomIcon icon={staged} size={21} className="flex flex-[0_0_22px] items-center justify-center text-2xl" />
            <span className="truncate">{roomIconLabel(staged)}</span>
          </span>
          <div className="flex flex-none gap-2 max-[600px]:justify-end">
            <button type="button" onClick={cancel} className={cn(BUTTON, FOOTER_BUTTON)}>
              Cancel
            </button>
            <button type="button" onClick={apply} className={cn(BUTTON, FOOTER_BUTTON, "border-transparent bg-foreground text-background hover:not-active:brightness-70")}>
              Use icon
            </button>
          </div>
        </footer>
      </dialog>
    </div>
  );
}
