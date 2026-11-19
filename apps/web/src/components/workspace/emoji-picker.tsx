import { useEffect, useRef, useState } from "react";
import { Emoji } from "@/components/icons/iconoir";
import { cn } from "@/lib/utils";

/**
 * Opens a small grid of emojis to pick from: the one the mood's emoji and a custom reaction share, so
 * both offer the same emojis to tap, beside the field that still takes any emoji typed or pasted.
 */
export function EmojiPicker({
  emojis,
  onPick,
  label = "Pick an emoji",
  disabled,
}: {
  /** The emojis to offer, each with the name its button says. */
  emojis: ReadonlyArray<readonly [emoji: string, name: string]>;
  /** Takes the emoji picked, as the field beside this keeps it. */
  onPick: (emoji: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const gone = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", gone);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", gone);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[9px] border border-border bg-background text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover aria-expanded:text-foreground",
          disabled && "opacity-50",
        )}
        onClick={() => setOpen((was) => !was)}
      >
        <Emoji className="size-4" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute bottom-full left-0 z-20 mb-2 grid w-[17.5rem] grid-cols-8 gap-[2px] rounded-[10px] border bg-surface p-2 shadow-lg"
        >
          {emojis.map(([emoji, name]) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-label={name}
              aria-selected={false}
              title={name}
              className="rounded-md p-1 text-xl leading-none hover:bg-hover"
              onClick={() => {
                onPick(emoji);
                setOpen(false);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
