import { useEffect, type ComponentProps, type ReactNode } from "react";
import type { Bootstrap } from "@ember/protocol";
import { HelpContact } from "@/components/help-contact";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// What ember-rust's sign-in and join pages share (sessions/new.html and users/new.html, styled by the
// .mb-auth-* rules in zz-ember.css): a card on the surface, holding a heading and a form, with the
// help contact under it.

/** What the app knows about the workspace before anyone signs in. */
export type SignedOutWorkspace = Omit<Bootstrap, "user">;

/** Campfire's `.input` with ember-rust's `.mb-field > .input`: 16px text, so phones don't zoom in. */
export const AUTH_INPUT =
  "h-auto min-h-[42px] touch:min-h-11 rounded-[9px] border-border bg-background px-[11px] py-[9px] text-base md:text-base shadow-none focus:border-muted-foreground focus-visible:border-muted-foreground focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-solid focus-visible:outline-foreground";

/** ember-rust's `.mb-auth-form`. */
export const AUTH_FORM = "flex flex-col gap-5";

/** Names the tab `title` while the page is open. */
export function useTitle(title: string): void {
  useEffect(() => {
    const before = document.title;
    document.title = title;
    return () => void (document.title = before);
  }, [title]);
}

/** ember-rust's `.mb-auth-page`: what `children` holds, the card and anything above it, then the help contact. */
export function AuthPage({ workspace, children }: { workspace: SignedOutWorkspace; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-surface pt-header pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] max-md:pt-[calc(56px+env(safe-area-inset-top))]">
      {children}
      <HelpContact contact={workspace.helpContact} version={workspace.version} />
    </main>
  );
}

/** Something that went wrong apart from the form, such as the connection, said above the card. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <div role="alert" aria-atomic="true" className="mx-auto mt-6 w-[440px] max-w-[calc(100%-32px)] rounded-lg border bg-card px-4 py-3.5 max-md:max-w-[calc(100%-24px)]">
      {children}
    </div>
  );
}

/** ember-rust's `.panel.mb-auth-card`. */
export function AuthCard({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "mx-auto mt-[clamp(24px,7vh,88px)] mb-6 w-[440px] max-w-[calc(100%-32px)] rounded-2xl border bg-background p-8 text-start max-md:my-[18px] max-md:max-w-[calc(100%-24px)] max-md:rounded-xl max-md:px-5 max-md:py-6",
        className,
      )}
      {...props}
    />
  );
}

/** ember-rust's `.mb-auth-heading`: Ember's flame, until workspaces have logos, over the title and a line under it. */
export function AuthHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="mb-7 text-center">
      <img src="/ember-icon.png" alt="Ember" width={48} height={48} className="mx-auto mb-5 block size-12 object-contain" />
      <h1 className="mb-2 text-2xl leading-tight font-[650]">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </header>
  );
}

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

/** ember-rust's `.mb-primary-button`, which sends the card's form. */
export function SubmitButton({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  return (
    <Button type="submit" disabled={disabled} className="h-auto min-h-[42px] w-full rounded-[9px] border border-primary px-4 py-2.5 text-sm font-[550] touch:min-h-11">
      {children}
    </Button>
  );
}
