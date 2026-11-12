import { useRef, useState, type Ref } from "react";
import { CheckCircle } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { chooseAppearance, useAppearance } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { NavigationIcon } from "./navigation-icon";
import { useMediaQuery } from "@/hooks/use-media-query";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/**
 * The rail's appearance button: it's named for the choice shown and opens a small dialog of Light, Dark
 * and System radio buttons. A choice applies at once and leaves the dialog open, which Escape or a click
 * elsewhere closes. Its icons are those an administrator chose in Community settings, or, like the
 * rail's, Iconoir's.
 */
export function AppearanceMenu() {
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  const coarse = useMediaQuery("(pointer: coarse)");
  const button = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLFieldSetElement>(null);
  const { label } = OPTIONS.find((option) => option.value === appearance)!;

  return (
    // Beside the rail on a touch screen, it covers the conversations, so there it's modal: they take no
    // taps until it's closed, as a tap outside it closes it.
    <Popover open={open} onOpenChange={setOpen} modal={coarse}>
      <PopoverTrigger
        ref={button}
        className="mt-auto flex size-9 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground touch:size-11"
        aria-label={`Appearance: ${label}`}
        title={`Appearance: ${label}`}
      >
        <NavigationIcon slot={appearance} size={18} className="size-[18px]" />
      </PopoverTrigger>
      <PopoverContent
        aria-label="Appearance"
        side="right"
        align="end"
        sideOffset={8}
        className="w-[190px] rounded-[12px] bg-background p-2 shadow-[0_8px_24px_#0002]"
        // Opening focuses the current choice, and Tab closes the dialog and goes on from its button.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          choices.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          button.current?.focus();
          setOpen(false);
        }}
      >
        <AppearanceChoices ref={choices} />
      </PopoverContent>
    </Popover>
  );
}

interface ChoicesProps {
  ref?: Ref<HTMLFieldSetElement>;
  /** Classes for the legend and each choice, over the menu's, as a phone's You sheet sizes them. */
  legendClassName?: string;
  choiceClassName?: string;
  /** Each choice's icon's size: the menu's 18px, or a sheet's 24px, as its other rows' icons are. */
  iconSize?: 18 | 24;
}

/**
 * Light, Dark and System as radio buttons under an Appearance legend, each with its icon and a check on
 * the one shown. A choice applies and is saved at once.
 */
export function AppearanceChoices({ ref, legendClassName, choiceClassName, iconSize = 18 }: ChoicesProps) {
  const appearance = useAppearance();
  return (
    <fieldset ref={ref}>
      <legend className={cn("px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground", legendClassName)}>Appearance</legend>
      {OPTIONS.map(({ value, label }) => (
        <label
          key={value}
          className={cn(
            "relative flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[7px] p-2 hover:bg-hover has-checked:bg-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-foreground touch:min-h-11",
            choiceClassName,
          )}
        >
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={appearance === value}
            onChange={() => chooseAppearance(value)}
            className="peer absolute size-px opacity-0 [clip-path:inset(50%)]"
          />
          <NavigationIcon slot={value} size={iconSize} className={cn("shrink-0", iconSize === 18 ? "size-[18px]" : "size-6")} />
          <span>{label}</span>
          <CheckCircle className="invisible ml-auto size-[18px] shrink-0 peer-checked:visible" />
        </label>
      ))}
    </fieldset>
  );
}
