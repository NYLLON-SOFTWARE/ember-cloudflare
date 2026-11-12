interface Props {
  on: boolean;
  /** Whether it's held on, as Activity holds the DMs page's on while it's pressed. */
  disabled?: boolean;
  onChange: (on: boolean) => void;
}

/**
 * Unreads, at the top of a list column, as the DMs page's list and Activity's have it: a chip that says
 * itself whether it's on, filled while it is.
 */
export function UnreadsSwitch({ on, disabled = false, onChange }: Props) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="shrink-0 cursor-pointer rounded-full border px-2.5 py-0.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background disabled:cursor-not-allowed touch:min-h-11 touch:px-3.5"
    >
      Unreads
    </button>
  );
}
