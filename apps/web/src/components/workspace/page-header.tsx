import { createContext, useContext, type ReactNode } from "react";
import { Menu } from "@/components/icons/ember";
import { SheetTrigger } from "@/components/ui/sheet";

/** Whether the conversations drawer is open, which the header's button for it says in its name. */
export const DrawerOpen = createContext(false);

/**
 * ember-rust's top bar, the navigation landmark "Page" (`nav#nav.mb-header`, layouts/application.html),
 * holding what the page puts in it. At 900px and below it starts with the button that opens the
 * conversations drawer, named for what it does next, as ember-rust's shell.js names it.
 */
export function PageHeader({ children }: { children?: ReactNode }) {
  const drawerOpen = useContext(DrawerOpen);
  return (
    <nav
      aria-label="Page"
      className="flex min-h-header items-center gap-3 border-b bg-background py-2.5 pr-[max(22px,env(safe-area-inset-right))] pl-[22px] narrow:pr-[max(18px,env(safe-area-inset-right))] narrow:pl-[18px] max-md:min-h-14 max-md:gap-1.5 max-md:pt-[env(safe-area-inset-top)] max-md:pb-0 max-md:pr-[max(8px,env(safe-area-inset-right))] max-md:pl-[max(8px,env(safe-area-inset-left))]"
    >
      <SheetTrigger aria-label={drawerOpen ? "Close conversations" : "Open conversations"} className="hidden size-11 shrink-0 items-center justify-center rounded-lg max-md:flex">
        <Menu className="size-[22px]" />
      </SheetTrigger>
      {children}
    </nav>
  );
}

/** A `.btn` in the top bar holding only an icon: a 36px square, 44px for fingers, that a pointer highlights. */
export const HEADER_BUTTON = "grid size-9 shrink-0 place-items-center rounded-lg hover:bg-hover touch:size-11";

/** A `.btn` in the top bar holding an icon and its text, 44px tall for fingers, which ember-rust's isn't. */
export const HEADER_TEXT_BUTTON =
  "inline-flex items-center justify-center gap-[0.5em] rounded-lg border border-transparent px-[1.1em] py-[0.5em] font-medium hover:bg-hover touch:min-h-11";
