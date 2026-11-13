import { useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppearance } from "@/lib/appearance";
import { NavigationIcon } from "./navigation-icon";
import { useMediaQuery } from "@/hooks/use-media-query";

import { preloadRarePages, RarePage } from "./rare-pages";

/** The appearances to choose from, and what each is called. */
export const APPEARANCES = [
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
  const { label } = APPEARANCES.find((option) => option.value === appearance)!;

  return (
    // Beside the rail on a touch screen, it covers the conversations, so there it's modal: they take no
    // taps until it's closed, as a tap outside it closes it.
    <Popover open={open} onOpenChange={setOpen} modal={coarse}>
      <PopoverTrigger
        ref={button}
        className="mt-auto flex size-9 shrink-0 items-center justify-center rounded-full border text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground touch:size-11"
        aria-label={`Appearance: ${label}`}
        onPointerEnter={preloadRarePages}
        onFocus={preloadRarePages}
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
        {/* The choices load with the pages, from when the button's pointed at or focused. */}
        <RarePage show={({ AppearanceChoices }) => <AppearanceChoices ref={choices} />} loading={<div className="h-[148px]" />} />
      </PopoverContent>
    </Popover>
  );
}
