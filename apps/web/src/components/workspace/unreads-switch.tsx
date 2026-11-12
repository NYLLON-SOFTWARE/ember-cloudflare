import { useId } from "react";
import { Switch } from "@/components/ui/switch";

interface Props {
  on: boolean;
  /** Whether it's held on, as Activity holds the DMs page's on while it's pressed. */
  disabled?: boolean;
  onChange: (on: boolean) => void;
}

/**
 * Unreads, the switch at the top of a list column, as the DMs page's list and Activity's have it: the
 * 14px switch, after a 13px semibold label, which toggles it too.
 */
export function UnreadsSwitch({ on, disabled = false, onChange }: Props) {
  const id = useId();
  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="cursor-pointer text-[13px] font-semibold text-foreground">
        Unreads
      </label>
      <Switch id={id} checked={on} disabled={disabled} onCheckedChange={onChange} />
    </span>
  );
}
