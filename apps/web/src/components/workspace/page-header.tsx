import type { ReactNode } from "react";
import { Menu } from "@/components/icons/ember";
import { SheetTrigger } from "@/components/ui/sheet";

/**
 * ember-rust's top bar, `#nav.mb-header` (layouts/application.html), holding what the page puts in
 * it. Below 900px it starts with the button that opens the conversations drawer.
 */
export function PageHeader({ children }: { children: ReactNode }) {
  return (
    <header className="flex min-h-header items-center gap-3 border-b bg-background py-2.5 pr-[max(22px,env(safe-area-inset-right))] pl-[22px] max-md:min-h-14 max-md:gap-1.5 max-md:pt-[env(safe-area-inset-top)] max-md:pr-[max(8px,env(safe-area-inset-right))] max-md:pl-[max(8px,env(safe-area-inset-left))]">
      <SheetTrigger aria-label="Open conversations" className="hidden size-11 shrink-0 items-center justify-center rounded-lg max-md:flex">
        <Menu className="size-[22px]" />
      </SheetTrigger>
      {children}
    </header>
  );
}

/** A `.btn` in the top bar holding only an icon: a 36px square, 44px for fingers, that a pointer highlights. */
export const HEADER_BUTTON = "grid size-9 shrink-0 place-items-center rounded-lg hover:bg-hover touch:size-11";
