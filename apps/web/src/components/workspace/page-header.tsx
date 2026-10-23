import { createContext, useContext, type ReactNode } from "react";
import { Menu } from "@/components/icons/ember";
import { SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SettingsLayout, SettingsNavigation } from "./settings-navigation";

/** Whether the drawer is open, which the header's button for it says in its name. */
export const DrawerOpen = createContext(false);

/**
 * ember-rust's top bar, the navigation landmark "Page" (`nav#nav.mb-header`, layouts/application.html),
 * holding what the page puts in it. At 900px and below it starts with the button that opens the
 * drawer, named for what it does next, as ember-rust's shell.js names it.
 *
 * On a page of community settings it spans the column of their links too, ends with "Community
 * settings", and the links follow it (`SettingsNavigation`), where the conversations would be, as
 * ember-rust's pull request #24 lays the page out: there the drawer holds only the rail, so its button
 * opens and closes the navigation. The links come after the bar rather than after the page, as
 * ember-rust's do, so Tab reaches them in the order they're seen.
 */
export function PageHeader({ children }: { children?: ReactNode }) {
  const drawerOpen = useContext(DrawerOpen);
  const settings = useContext(SettingsLayout);
  const drawer = settings ? "navigation" : "conversations";
  return (
    <>
      <nav
        aria-label="Page"
        className={cn(
          "flex min-h-header items-center gap-3 border-b bg-background py-2.5 pr-[max(22px,env(safe-area-inset-right))] pl-[22px] narrow:pr-[max(18px,env(safe-area-inset-right))] narrow:pl-[18px] max-md:min-h-14 max-md:gap-1.5 max-md:pt-[env(safe-area-inset-top)] max-md:pb-0 max-md:pr-[max(8px,env(safe-area-inset-right))] max-md:pl-[max(8px,env(safe-area-inset-left))]",
          settings && "md:col-span-2",
        )}
      >
        {/* Marked as ember-rust's is, for New direct message to give focus back to once the drawer's gone. */}
        <SheetTrigger
          data-ember-sidebar-toggle
          aria-label={`${drawerOpen ? "Close" : "Open"} ${drawer}`}
          className="hidden size-11 shrink-0 items-center justify-center rounded-lg max-md:flex"
        >
          <Menu className="size-[22px]" />
        </SheetTrigger>
        {children}
        {/* `.mb-header-title`. */}
        {settings && <h1 className="min-w-0 flex-1 text-[17px] leading-[1.4] font-[650] max-md:text-base">Community settings</h1>}
      </nav>
      {settings && <SettingsNavigation {...settings} />}
    </>
  );
}

/** A `.btn` in the top bar holding only an icon: a 36px square, 44px for fingers, that a pointer highlights. */
export const HEADER_BUTTON = "grid size-9 shrink-0 place-items-center rounded-lg hover:bg-hover touch:size-11";

/** A `.btn` in the top bar holding an icon and its text, 44px tall for fingers, which ember-rust's isn't. */
export const HEADER_TEXT_BUTTON =
  "inline-flex items-center justify-center gap-[0.5em] rounded-lg border border-transparent px-[1.1em] py-[0.5em] font-medium hover:bg-hover touch:min-h-11";
