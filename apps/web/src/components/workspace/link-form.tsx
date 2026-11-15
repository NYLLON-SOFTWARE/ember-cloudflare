import { useEffect, useEffectEvent, useId, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { TEXT_BUTTON } from "./composer-buttons";
import { linkAddress } from "./formatting";

/** The Link field's text boxes, 36px tall, or 44px with 16px text on touch screens. */
const FIELD =
  "h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-selected-dark aria-invalid:border-negative touch:h-11 touch:text-base";
const LABEL = "mb-1 block text-[13px] font-semibold";
interface Props {
  linked: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (url: string | null, text: string) => void;
  draft: () => { text: string; url: string };
}

/**
 * The Link field's fields (`LinkField` in composer-toolbar.tsx), which load with the pages: Text, what's
 * selected or the link's own, and Link, its address. Enter or Save links the text to the address, Cancel
 * leaves it, and Remove link, there for a link already, unlinks it.
 */
export function LinkForm({ linked, onOpenChange, onLink, draft }: Props) {
  const [text, setText] = useState("");
  const [address, setAddress] = useState("");
  const [refused, setRefused] = useState(false);
  const ids = { text: useId(), address: useId() };
  // What's selected as it opens, however it opens: Link, or Ctrl or Cmd+K.
  const start = useEffectEvent(() => {
    const started = draft();
    setText(started.text);
    setAddress(started.url);
    setRefused(false);
  });
  // The fields mount as the popover opens.
  useEffect(() => start(), []);
  const save = () => {
    const url = linkAddress(address);
    if (url === null) return setRefused(true);
    onLink(url, text.trim() === "" ? url : text);
    onOpenChange(false);
  };
  const saveOnEnter = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save();
  };
  return (
    <>
      <label htmlFor={ids.text} className={LABEL}>
        Text
      </label>
      <input id={ids.text} type="text" autoComplete="off" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={saveOnEnter} className={cn(FIELD, "mb-2.5")} />
      <label htmlFor={ids.address} className={LABEL}>
        Link
      </label>
      <input
        id={ids.address}
        type="text"
        inputMode="url"
        autoComplete="off"
        // Where text is selected, the address is what's left to give.
        autoFocus
        value={address}
        aria-invalid={refused || undefined}
        onChange={(event) => {
          setAddress(event.target.value);
          setRefused(false);
        }}
        onKeyDown={saveOnEnter}
        className={FIELD}
      />
      {refused && (
        <p role="alert" className="mt-1.5 text-[12px] text-negative">
          Enter a web address, such as example.com.
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {linked && (
          <button
            type="button"
            onClick={() => {
              onOpenChange(false);
              onLink(null, text);
            }}
            className={cn(TEXT_BUTTON, "mr-auto px-2.5 font-normal text-negative hover:bg-hover")}
          >
            Remove link
          </button>
        )}
        <button type="button" onClick={() => onOpenChange(false)} className={cn(TEXT_BUTTON, "hover:bg-hover")}>
          Cancel
        </button>
        <button type="button" onClick={save} className={cn(TEXT_BUTTON, "bg-foreground text-background hover:brightness-85")}>
          Save
        </button>
      </div>
    </>
  );
}
