import type { ComponentProps, MouseEvent, ReactNode } from "react";
import { Plus } from "@/components/icons/iconoir";
import { MainContent } from "@/components/main-content";
import { PageLink } from "@/components/page-link";
import { NEW_DIRECT_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { opensNewDirect } from "../workspace/dialog-openers";
import { PageHeader } from "../workspace/page-header";

export { YouButton as YouLink } from "./you-sheet";

/**
 * Marks a phone page's `<main>` as one the tab bar floats over, fading the page out behind it rather than
 * ending it at a band of its own (tab-bar.css). Every TabPage has it; another page spreads it on its own
 * `<main>`, and then pads the end of what scrolls in it, so its last row can be scrolled clear, by one of
 * the two lengths tab-bar.css sets on such a `<main>`, which are only set there:
 *
 * - `--mobile-tab-bar-inset`, what the tab bar covers, the home indicator under it too, for a page
 *   without the floating New direct message button;
 * - `--mobile-bottom-inset`, the whole floating stack, the tab bar and that button over it, with 16px to
 *   spare, as `pb-[var(--mobile-bottom-inset,0px)]`.
 *
 * Neither is set while the on-screen keyboard is up, when the tab bar makes way for it.
 */
export const UNDER_TAB_BAR = { "data-under-tab-bar": "" } as const;

interface TabPageProps {
  /** What heads the page in its top bar, its title or, on Home, the workspace's. */
  heading: ReactNode;
  /** What the top bar has at its other end, your avatar unless the page says otherwise. */
  actions: ReactNode;
  children: ReactNode;
  /** The floating button at the bottom right, if the page has one. */
  floating?: ReactNode;
}

/**
 * One of the tabs' pages on a phone: its title, or Home's workspace, in the top bar, and what's on the
 * page under it, which scrolls, with a floating button over its bottom right.
 */
export function TabPage({ heading, actions, children, floating }: TabPageProps) {
  return (
    <>
      <PageHeader>
        <div className="flex min-w-0 flex-1 items-center gap-2.5 pl-2">{heading}</div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </PageHeader>
      <MainContent {...UNDER_TAB_BAR} className="relative flex min-h-0 min-w-0 flex-col bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {children}
        {floating}
      </MainContent>
    </>
  );
}

/** A tab's title in its top bar. */
export function TabTitle({ children }: { children: ReactNode }) {
  return <h1 className="truncate text-[22px] leading-7 font-bold">{children}</h1>;
}

/**
 * New direct message, Slack's floating "+" at the bottom right of Home and DMs, 16px over the tab bar and
 * in line with its Search, which opens the dialog in place.
 */
export function NewMessageButton({ onNewDirect }: { onNewDirect: (opener: HTMLElement) => void }) {
  return (
    <a
      href={NEW_DIRECT_PATH}
      aria-label="New direct message"
      title="New direct message"
      onClick={opensNewDirect(onNewDirect)}
      className="absolute right-[max(16px,env(safe-area-inset-right))] bottom-[calc(var(--mobile-tab-bar-inset,0px)+16px)] z-[2] grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_14px_var(--color-drag-shadow)] hover:brightness-90"
    >
      <Plus className="size-6" />
    </a>
  );
}

interface Chip<T extends string> {
  value: T;
  label: string;
}

interface ChipsProps<T extends string> {
  /** What the chips filter, which names them for screen readers. */
  label: string;
  chips: Chip<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** A row of filters, Slack's chips, one of which is on: buttons pressed or not, which scrolls sideways when it's wider than the phone. */
export function Chips<T extends string>({ label, chips, value, onChange }: ChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 gap-2 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
      {chips.map((chip) => (
        <button
          key={chip.value}
          type="button"
          aria-pressed={chip.value === value}
          onClick={() => onChange(chip.value)}
          className="min-h-11 shrink-0 cursor-pointer rounded-full border px-4 text-[15px] font-medium text-muted-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

/** A list on a tab's page, which scrolls under its chips, and behind the tab bar and floating button, clear of them at its end. */
export function TabList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--mobile-bottom-inset,6rem)]", className)} {...props} />;
}

interface RowProps {
  href: string;
  /** What starts the row: an avatar or a room's icon, 36px across. */
  leading: ReactNode;
  title: ReactNode;
  /** The smaller, muted line under the title, if there is one. */
  detail?: ReactNode;
  /** What the row ends with, such as when it was last active. */
  trailing?: ReactNode;
  unread?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/** A row of a tab's list, a link to a conversation: bold, with a dot, while it's unread. */
export function TabRow({ href, leading, title, detail, trailing, unread = false, onClick }: RowProps) {
  return (
    <li>
      <PageLink
        href={href}
        onClick={onClick}
        aria-description={unread ? "Unread" : undefined}
        className="flex min-h-14 items-center gap-3 px-4 py-2.5 text-foreground no-underline hover:bg-hover"
      >
        <span className="grid size-9 shrink-0 place-items-center">{leading}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className={cn("truncate text-base leading-6", unread ? "font-bold" : "font-medium")}>{title}</span>
          {detail && <span className="truncate text-sm leading-5 text-muted-foreground">{detail}</span>}
        </span>
        {(trailing || unread) && (
          <span className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
            {trailing && <span className="text-[13px] leading-5 text-muted-foreground">{trailing}</span>}
            {unread && <span aria-hidden="true" className="size-2.5 rounded-full bg-foreground" />}
          </span>
        )}
      </PageLink>
    </li>
  );
}

/** What a tab's list says when there's nothing in it. */
export function EmptyList({ children }: { children: ReactNode }) {
  return <p className="px-6 py-10 text-center text-[15px] text-muted-foreground">{children}</p>;
}
