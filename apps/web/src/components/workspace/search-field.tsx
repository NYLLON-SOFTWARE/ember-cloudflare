import { useRef } from "react";
import { Search, Xmark } from "@/components/icons/iconoir";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Its name for screen readers. */
  label: string;
}

/**
 * A field that narrows a list, as Find a DM… and People's search do: a magnifier, what's typed, and a
 * clear button of its own while something's typed, as the browser's own is drawn in its own blue. 16px on
 * touch screens, so iOS doesn't zoom in on it.
 */
export function SearchField({ value, onChange, placeholder, label }: Props) {
  const field = useRef<HTMLInputElement>(null);
  return (
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={field}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-9 w-full rounded-lg border bg-background pr-8 pl-8 text-[14px] outline-none placeholder:text-muted-foreground focus-visible:border-ring touch:h-11 touch:text-base max-md:text-base [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value !== "" && (
        <button
          type="button"
          aria-label="Clear"
          title="Clear"
          onClick={() => {
            onChange("");
            field.current?.focus();
          }}
          className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground touch:size-9"
        >
          <Xmark className="size-4" />
        </button>
      )}
    </div>
  );
}
