import { useEffect, useRef, useState, type RefObject } from "react";
import { Dismiss, PencilSquare } from "@/components/icons/ember";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { guardLeaving } from "@/hooks/use-route";
import { cn } from "@/lib/utils";

// ember-rust's guard for room forms (crates/assets/overrides/ember/settings.js) and its dialog
// (components/unsaved_changes.html), styled by zz-ember.css (.mb-unsaved-*). Where the app's other
// dialogs are native ones, as ember-rust's are, this is a Radix dialog, so it can open over the
// drawer, a Radix dialog itself, which would keep the pointer and focus from a native one.

/** `.mb-unsaved-actions .btn`: Campfire's `.btn`, 42px tall, 44px for fingers, and sharing a phone's width. */
const ACTION = "inline-flex min-h-[42px] cursor-pointer items-center justify-center rounded-[9px] border px-[22px] py-[0.5em] font-semibold touch:min-h-11 disabled:cursor-default max-[480px]:flex-1";

interface Props {
  /** Whether the form holds changes that leaving would lose. */
  changed: boolean;
  /** Whether going to `path` keeps the form, as the Everyone switch's move to the other form does. */
  stays: (path: string) => boolean;
  /**
   * Saves the changes, settling once the server has them, after which the page compares its form with
   * what's saved, as settings.js does, in case it stays: when signing out fails, say.
   */
  onSave: () => Promise<unknown>;
  /** The form, whose fields Save checks first, and whose own dialogs close for this one. */
  form: RefObject<HTMLFormElement | null>;
}

/**
 * While a room's form holds changes, leaving the page, by a link, Back or Forward, or signing out,
 * first asks whether to save or discard them, and reloading or closing the tab has the browser ask.
 */
export function UnsavedChanges({ changed, stays, onSave, form }: Props) {
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // How to go where the person was going, once they decide to.
  const proceed = useRef<(() => unknown) | null>(null);
  // Once Discard or Save lets the page go, nothing asks again, unless it doesn't go after all.
  const released = useRef(false);
  // Save found a field the form won't accept, which the browser points at once the dialog has closed.
  const invalid = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!changed) return;
    return guardLeaving((path, go) => {
      if (released.current || (path !== null && stays(path))) return false;
      // While Save is under way, leaving waits for it, as in ember-rust.
      if (saving) return true;
      proceed.current = go;
      setFailed(false);
      // The form's own dialogs, such as the icon picker, are native ones, which would stay above this one
      // and keep it from being answered, where ember-rust's, native too, opens above them. They close first.
      for (const dialog of form.current?.querySelectorAll<HTMLDialogElement>("dialog[open]") ?? []) dialog.close();
      setAsking(true);
      return true;
    });
  }, [changed, stays, saving, form]);

  // Listening only while there's something to lose keeps the page eligible for the browser's
  // back/forward cache, as ember-rust keeps it.
  useEffect(() => {
    if (!changed) return;
    const unload = (event: BeforeUnloadEvent) => {
      if (!released.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [changed]);

  const keepEditing = () => {
    if (saving) return;
    proceed.current = null;
    setAsking(false);
  };

  const go = async () => {
    const next = proceed.current;
    released.current = true;
    proceed.current = null;
    setAsking(false);
    // A sign-out that fails leaves the page as it was, so the form is guarded again, as ember-rust's
    // settings.js guards it again when the form it let through isn't sent.
    if ((await next?.()) === false) released.current = false;
  };

  const save = async () => {
    if (!form.current?.checkValidity()) {
      invalid.current = true;
      return keepEditing();
    }
    setSaving(true);
    setFailed(false);
    try {
      await onSave();
    } catch {
      // Whatever went wrong, as ember-rust says for anything but a confirmed save.
      setFailed(true);
      return;
    } finally {
      setSaving(false);
    }
    await go();
  };

  return (
    <Dialog open={asking} onOpenChange={(open) => open || keepEditing()}>
      <DialogContent
        showCloseButton={false}
        aria-busy={saving || undefined}
        overlayClassName="bg-dialog-backdrop backdrop-blur-[3px]"
        // As ember-rust's opens on Save and stays open when the page behind it is clicked.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          saveButton.current?.focus();
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (!invalid.current) return;
          invalid.current = false;
          event.preventDefault();
          form.current?.reportValidity();
        }}
        className={cn(
          "block w-[420px] max-w-[calc(100dvw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))] sm:max-w-[calc(100dvw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))]",
          "max-h-[calc(100dvh-32px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-auto rounded-[18px] p-7 text-foreground max-[480px]:p-6",
          "shadow-[0_24px_80px_var(--color-dialog-shadow),0_4px_16px_var(--color-dialog-shadow-faint)]",
        )}
      >
        <button
          type="button"
          aria-label="Keep editing"
          disabled={saving}
          onClick={keepEditing}
          className="absolute end-3 top-3 inline-flex cursor-pointer items-center justify-center rounded-[9px] px-[1.1em] py-[0.5em] touch:min-h-11 disabled:cursor-default"
        >
          <Dismiss className="size-[18px]" />
        </button>
        <div aria-hidden="true" className="mb-5 grid size-[46px] place-items-center rounded-xl border bg-surface">
          <PencilSquare className="size-[22px]" />
        </div>
        <DialogTitle className="mb-2.5 text-[22px] leading-[1.25] font-bold">Unsaved Changes</DialogTitle>
        <DialogDescription className="leading-[1.65]">
          You’ve made changes to this room. Save them before you leave, or discard them to keep things as they were.
        </DialogDescription>
        {failed && (
          <p role="alert" className="mt-4 text-sm leading-[1.65] text-negative">
            Your changes couldn’t be saved. Please try again, or keep editing.
          </p>
        )}
        <div className="mt-[26px] flex justify-end gap-2.5">
          <button type="button" disabled={saving} onClick={() => void go()} className={cn(ACTION, "bg-background text-foreground")}>
            Discard
          </button>
          <button
            ref={saveButton}
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className={cn(ACTION, "border-transparent bg-foreground text-background hover:not-active:brightness-70")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
