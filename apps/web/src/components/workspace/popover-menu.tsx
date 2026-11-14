import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** An item of a `PopoverMenu`: what it says, and what choosing it does. */
export interface MenuItem {
  label: ReactNode;
  /** What screen readers call it, when its label isn't text. */
  name?: string;
  icon?: ReactNode;
  /** For a menu of choices, whether this is the one chosen, which makes the items radio items. */
  checked?: boolean;
  /** For an item that turns something on and off, whether it's on, which makes it a checkbox item. */
  pressed?: boolean;
  disabled?: boolean;
  className?: string;
  onSelect: () => void;
}

/** One of the menu's items, which Up and Down Arrow move between, as a menu's do. */
const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none select-none hover:bg-accent focus-visible:bg-accent touch:min-h-11 disabled:pointer-events-none disabled:opacity-35 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** Moves focus to the next item, or the previous, wrapping round, or to the first or last: from the menu itself, the first or the last. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-menu-item]:not(:disabled)")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = { ArrowDown: at + 1, ArrowUp: at === -1 ? items.length - 1 : at - 1, Home: 0, End: items.length - 1 }[event.key];
  if (next === undefined || items.length === 0) return;
  event.preventDefault();
  items[(next + items.length) % items.length]!.focus();
}

interface Props {
  /** The button that opens it, which it's anchored to. */
  trigger: ReactElement;
  /** What screen readers call it, and the heading it shows, if any. */
  label: string;
  heading?: boolean;
  items: MenuItem[];
  /** Items after a rule, under the others. */
  more?: MenuItem[];
  side?: "top" | "bottom";
  align?: "start" | "end";
  /** Where focus goes once it closes, rather than back to its button, as the composer keeps it in the text. */
  onCloseFocus?: () => void;
  /** Whether it's open, for a menu something besides its button opens, as a long press on Send opens Schedule message. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A menu on a popover, as Slack's composer's menus are: its items, or radio items for a choice, which
 * Up and Down Arrow, Home and End move between, and Enter or a click chooses, closing it. Opened from the
 * keyboard, its first item has focus; opened with a pointer, the menu itself does, so nothing looks
 * chosen. Built on the popover the app has already, rather than a dropdown menu of its own.
 */
export function PopoverMenu({ trigger, label, heading = false, items, more, side = "top", align = "start", onCloseFocus, open: shown, onOpenChange, className }: Props) {
  const [openHere, setOpen] = useState(false);
  const open = shown ?? openHere;
  // Whether its button was last pressed from the keyboard rather than with a pointer, as a long press is.
  const byKeyboard = useRef(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const item = ({ label, name, icon, checked, pressed, disabled, className, onSelect }: MenuItem, index: number) => (
    <button
      key={index}
      type="button"
      data-menu-item
      role={checked !== undefined ? "menuitemradio" : pressed !== undefined ? "menuitemcheckbox" : "menuitem"}
      aria-checked={checked ?? pressed}
      aria-label={name}
      disabled={disabled}
      onClick={() => {
        change(false);
        onSelect();
      }}
      className={cn(ITEM, checked && "font-semibold", className)}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger asChild onPointerDown={() => (byKeyboard.current = false)} onKeyDown={() => (byKeyboard.current = true)}>
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className={cn("w-auto min-w-[8rem] p-1", className)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const menu = event.currentTarget as HTMLElement;
          (byKeyboard.current ? (menu.querySelector<HTMLElement>("[data-menu-item]:not(:disabled)") ?? menu) : menu).focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!onCloseFocus) return;
          event.preventDefault();
          onCloseFocus();
        }}
        onKeyDown={moveFocus}
      >
        {heading && <p className="px-2 py-1.5 text-[13px] font-semibold text-muted-foreground">{label}</p>}
        {items.map(item)}
        {more && (
          <>
            <div role="separator" className="-mx-1 my-1 h-px bg-border" />
            {more.map((entry, index) => item(entry, items.length + index))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
