import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export interface SheetAction {
  label: string;
  /** What it says under its label, smaller and muted, if anything. */
  detail?: string;
  icon?: ReactNode;
  /** Whether it destroys something, as Delete message does, which shows it in the negative red. */
  negative?: boolean;
  onSelect: () => void;
}

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Whether the title is for screen readers only, where what the sheet holds says what it's for. */
  titleHidden?: boolean;
  /** What screen readers hear of what the sheet is for. */
  description?: string;
  /** Where focus goes as it closes, as Radix's `onCloseAutoFocus`; a sheet opened without a trigger sends it nowhere. */
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}

/** One of a sheet's actions: a full-width row, 52px tall at least, as Slack's are. */
export const ROW = "flex min-h-13 w-full shrink-0 cursor-pointer items-center gap-3 rounded-xl px-4 py-2.5 text-start text-base hover:bg-hover active:bg-hover";

/**
 * A phone's sheet, Slack's and iOS's: a card that slides up from the bottom of the screen, under a grabber,
 * which a tap outside it or Escape closes. What doesn't fit under the top of the screen scrolls.
 */
export function BottomSheet({ open, onOpenChange, title, titleHidden = false, description, onCloseAutoFocus, children }: BottomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "mx-auto max-h-[calc(100dvh-env(safe-area-inset-top)-8px)] max-w-[560px] gap-1 overflow-y-auto overscroll-contain rounded-t-[20px] border-x px-2 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]",
          "pr-[max(8px,env(safe-area-inset-right))] pl-[max(8px,env(safe-area-inset-left))]",
        )}
      >
        {/* The grabber, drawn as iOS draws a sheet's. */}
        <span aria-hidden="true" className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/40" />
        <SheetTitle className={titleHidden ? "sr-only" : "px-4 pt-1 pb-2 text-[15px] font-semibold text-muted-foreground"}>{title}</SheetTitle>
        <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  );
}

interface Props extends Omit<BottomSheetProps, "children"> {
  /** What comes before the actions, such as a message's quick reactions. */
  header?: ReactNode;
  actions: SheetAction[];
  /** Actions after a rule, such as Custom time after the presets. */
  more?: SheetAction[];
}

/**
 * A phone's action sheet: a bottom sheet with a row per action, which choosing an action closes too. It
 * takes the place of a desktop's popover menu, which a fingertip has to aim for and a phone's edges crowd.
 */
export function ActionSheet({ header, actions, more = [], ...sheet }: Props) {
  const choose = (action: SheetAction) => {
    sheet.onOpenChange(false);
    action.onSelect();
  };
  const row = (action: SheetAction) => (
    <button key={action.label} type="button" onClick={() => choose(action)} className={cn(ROW, action.negative && "text-negative")}>
      {action.icon && <span className={cn("grid size-6 shrink-0 place-items-center", action.negative ? "text-negative" : "text-muted-foreground")}>{action.icon}</span>}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{action.label}</span>
        {action.detail && <span className="truncate text-sm text-muted-foreground">{action.detail}</span>}
      </span>
    </button>
  );
  return (
    <BottomSheet {...sheet}>
      {header}
      {actions.map(row)}
      {more.length > 0 && <hr className="mx-4 my-1 border-t" />}
      {more.map(row)}
    </BottomSheet>
  );
}
