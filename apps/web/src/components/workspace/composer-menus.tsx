import { useState } from "react";
import { REACTIONS } from "@ember/protocol";
import { Emoji, Laptop, Page, Plus } from "@/components/icons/iconoir";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ATTACH_BUTTON, ICON_BUTTON } from "./composer-buttons";
import { PopoverMenu } from "./popover-menu";

// The composer's + menu and its Emoji picker.

/** +, Slack's attach menu: Upload from your computer, which opens the browser's file picker, and Files in Ember. */
export function AttachMenu({ disabled, onUpload, onFilesInEmber, onReturnFocus }: { disabled: boolean; onUpload: () => void; onFilesInEmber: () => void; onReturnFocus: () => void }) {
  return (
    <PopoverMenu
      label="Attach"
      className="min-w-60"
      onCloseFocus={onReturnFocus}
      trigger={
        <button type="button" disabled={disabled} title="Attach" onMouseDown={(event) => event.preventDefault()} className={ATTACH_BUTTON}>
          <Plus className="size-[18px]" />
          <span className="sr-only">Attach</span>
        </button>
      }
      items={[
        { label: "Upload from your computer", icon: <Laptop />, onSelect: onUpload },
        { label: "Files in Ember", icon: <Page />, onSelect: onFilesInEmber },
      ]}
    />
  );
}

/** Emoji, which offers the reactions' emoji to write at the cursor. */
export function EmojiButton({ disabled, onPick, onReturnFocus }: { disabled: boolean; onPick: (emoji: string) => void; onReturnFocus: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} title="Emoji" onMouseDown={(event) => event.preventDefault()} className={ICON_BUTTON}>
          <Emoji className="size-[18px]" />
          <span className="sr-only">Emoji</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-auto max-w-[min(20rem,calc(100vw-2rem))] p-2"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <div role="group" aria-label="Emoji" className="grid grid-cols-8 gap-0.5">
          {REACTIONS.map(([emoji, title]) => (
            <button
              key={emoji}
              type="button"
              title={title}
              aria-label={title}
              onClick={() => {
                setOpen(false);
                onPick(emoji);
              }}
              className="flex size-8 cursor-pointer items-center justify-center rounded-[6px] text-[20px] hover:bg-hover touch:size-11"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
