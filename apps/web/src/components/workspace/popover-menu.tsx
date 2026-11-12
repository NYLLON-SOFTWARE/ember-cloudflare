import { useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
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
  className?: string;
  onSelect: () => void;
}

/** One of the menu's items, which Up and Down Arrow move between, as a menu's do. */
const ITEM =
  "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none select-none hover:bg-accent focus-visible:bg-accent touch:min-h-11 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/** Moves focus to the next item, or the previous, wrapping round, or to the first or last. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-menu-item]")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
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
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A menu on a popover, as Slack's composer's menus are: its items, or radio items for a choice, which
 * Up and Down Arrow, Home and End move between, and Enter or a click chooses, closing it. Built on the
 * popover the app has already, rather than a dropdown menu of its own.
 */
export function PopoverMenu({ trigger, label, heading = false, items, more, side = "top", align = "start", onCloseFocus, onOpenChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const change = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const item = ({ label, name, icon, checked, className, onSelect }: MenuItem, index: number) => (
    <button
      key={index}
      type="button"
      data-menu-item
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      aria-label={name}
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
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        role="menu"
        aria-label={label}
        className={cn("w-auto min-w-[8rem] p-1", className)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-menu-item]")?.focus();
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
