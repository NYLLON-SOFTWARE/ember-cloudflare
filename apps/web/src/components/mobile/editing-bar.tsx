import { Xmark } from "@/components/icons/iconoir";

/**
 * Over the composer while it edits a message, as Slack iOS has it: what it's doing, and Cancel, which
 * goes back to what was written, as Escape does on a keyboard.
 */
export function EditingBar({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t bg-surface ps-4 pe-1 text-sm font-semibold text-muted-foreground">
      <span>Editing message</span>
      <button type="button" aria-label="Cancel editing" onClick={onCancel} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-foreground hover:bg-hover">
        <Xmark className="size-5" />
      </button>
    </div>
  );
}
