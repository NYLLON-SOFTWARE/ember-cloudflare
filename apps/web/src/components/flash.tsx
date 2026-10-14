import { Alert } from "@/components/icons/campfire";

/**
 * ember-rust's flash (crates/views/templates/layouts/application.html, styled in zz-ember.css): a red
 * notice 12px below the header, 56px tall on phones, that fades in and out, then goes. Only its
 * alerts are ported yet. It grows to fit its text, up to the screen's width less 24px, where
 * ember-rust's stops at half the screen's width, as Campfire's flash.css centers it from the
 * middle, and so wraps early on a phone.
 */
export function Flash({ children, onDone }: { children: string; onDone: () => void }) {
  return (
    <div onAnimationEnd={onDone} className="pointer-events-none fixed top-[calc(var(--spacing-header)+12px)] left-1/2 max-md:top-[calc(56px+12px)] z-30 flex w-max max-w-[calc(100dvw-24px)] -translate-x-1/2 justify-center">
      <div
        role="alert"
        aria-atomic="true"
        className="flex min-h-12 min-w-12 animate-flash items-center justify-center gap-2.5 rounded-[10px] bg-negative p-3 text-center text-white shadow-[0_8px_24px_#00000012]"
      >
        <Alert tone="white" width={24} height={24} className="size-6 flex-none" />
        <span>{children}</span>
      </div>
    </div>
  );
}
