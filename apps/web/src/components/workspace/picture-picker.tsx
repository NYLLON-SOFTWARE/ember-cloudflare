import type { ChangeEvent } from "react";
import { Camera } from "@/components/icons/iconoir";

/** `.btn.txt-small.mb-logo-remove`: Campfire's `.btn` in small, muted text, 44px tall for fingers. */
const REMOVE_BUTTON =
  "inline-flex cursor-pointer items-center justify-center gap-[0.5em] rounded-[9px] border bg-background px-3 py-[0.5em] text-[0.8rem] font-medium text-muted-foreground disabled:cursor-default disabled:opacity-50 touch:min-h-11";

interface Props {
  /** The file field's id. */
  id: string;
  /** The picture to show: the one saved, or the one picked while it saves. */
  src: string;
  /** What the picture is. */
  alt: string;
  /** What the field is called, for screen readers. */
  label: string;
  /** What's said under the picture. */
  description: string;
  /** Called with the file picked. */
  onChoose: (file: File) => void;
  /** Whether nothing can be picked or removed, as while the page loads or saves. */
  disabled: boolean;
  /** What Remove is called, where there's a picture to remove, and what it does. */
  remove: { label: string; onRemove: () => void } | null;
}

/**
 * ember-rust's `.mb-logo-upload` (zz-ember.css), which changes your avatar on your profile
 * (users/profiles/show.html), and the workspace's logo in its settings (accounts/edit.html): the picture
 * in a 96px circle with a camera on its corner, which picks a picture to save at once, a line saying
 * what to choose, and a button that removes the picture, where there's one to remove. The camera is
 * white in dark mode, as the logo's is, where ember-rust's profile leaves it black on the dark circle.
 */
export function PicturePicker({ id, src, alt, label, description, onChoose, disabled, remove }: Props) {
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The field forgets it, so picking the same file again picks it again.
    event.target.value = "";
    if (file) onChoose(file);
  };
  return (
    <div className="mt-2 mb-4 grid justify-items-center gap-3">
      <label
        htmlFor={id}
        className="group relative block size-24 cursor-pointer rounded-full has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-4 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-foreground"
      >
        <img src={src} alt={alt} width={96} height={96} className="size-full rounded-[inherit] border bg-surface object-cover" />
        <span
          aria-hidden="true"
          className="absolute -end-0.5 -bottom-0.5 flex size-9 items-center justify-center rounded-full border bg-background shadow-[0_1px_3px_#0002] group-hover:bg-hover"
        >
          <Camera className="size-[18px]" />
        </span>
        <input
          id={id}
          type="file"
          accept="image/*"
          aria-describedby={`${id}-description`}
          disabled={disabled}
          onChange={choose}
          className="absolute inset-0 size-full cursor-pointer rounded-[inherit] opacity-0 disabled:cursor-default"
        />
        <span className="sr-only">{label}</span>
      </label>
      <p id={`${id}-description`} className="text-[0.8rem] text-muted-foreground">
        {description}
      </p>
      {remove && (
        <button type="button" disabled={disabled} onClick={remove.onRemove} className={REMOVE_BUTTON}>
          {remove.label}
        </button>
      )}
    </div>
  );
}
