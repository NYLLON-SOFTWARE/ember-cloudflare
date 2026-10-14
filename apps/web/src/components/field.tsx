import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

// ember-rust's form pieces (styled in zz-ember.css), which its sign-in and join cards and its settings
// panels share.

/** Campfire's `.input` with ember-rust's `.mb-field > .input`: 16px text, so phones don't zoom in. */
export const FIELD_INPUT =
  "h-auto min-h-[42px] touch:min-h-11 rounded-[9px] border-border bg-background px-[11px] py-[9px] text-base md:text-base shadow-none focus:border-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-foreground";

/** ember-rust's `.mb-field`: a 13px label over its input. */
export function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[7px] text-start">
      <label htmlFor={id} className="text-[13px] font-[550]">
        {label}
      </label>
      {children}
    </div>
  );
}

/** ember-rust's `.mb-primary-button`, which sends its form. */
export function SubmitButton({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={disabled} className="h-auto min-h-[42px] w-full rounded-[9px] border border-primary px-4 py-2.5 text-sm font-[550] touch:min-h-11">
      {children}
    </Button>
  );
}
