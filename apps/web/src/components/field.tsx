import type { ReactNode } from "react";
import { TranslationButton } from "@/components/translation-button";
import { Button } from "@/components/ui/button";
import type { TranslationKey } from "@/lib/translations";

// ember-rust's form pieces (styled in zz-ember.css), which its sign-in and join cards and its settings
// panels share.

/** Campfire's `.input` with ember-rust's `.mb-field > .input`: 16px text, so phones don't zoom in. */
export const FIELD_INPUT =
  "h-auto min-h-[42px] touch:min-h-11 rounded-[9px] border-border bg-background px-[11px] py-[9px] text-base md:text-base shadow-none focus:border-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-foreground";

/**
 * ember-rust's `.mb-field`: a 13px label over its input, and beside the label, in `.mb-field-label`, the
 * translation button for what the field asks, if it has one.
 */
export function Field({ id, label, translation, children }: { id: string; label: string; translation?: TranslationKey; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[7px] text-start">
      <div className="flex items-center gap-2 text-[13px] font-[550]">
        <label htmlFor={id}>{label}</label>
        {translation && <TranslationButton translations={translation} />}
      </div>
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
