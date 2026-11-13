import type { Ref } from "react";
import { CheckCircle } from "@/components/icons/iconoir";
import { chooseAppearance, useAppearance } from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { APPEARANCES } from "./appearance-menu";
import { NavigationIcon } from "./navigation-icon";


interface ChoicesProps {
  ref?: Ref<HTMLFieldSetElement>;
  /** Classes for the legend and each choice, over the menu's, as a phone's You sheet sizes them. */
  legendClassName?: string;
  choiceClassName?: string;
  /** Each choice's icon's size: the menu's 18px, or a sheet's 24px, as its other rows' icons are. */
  iconSize?: 18 | 24;
}

/**
 * Light, Dark and System as radio buttons under an Appearance legend, each with its icon and a check on
 * the one shown. A choice applies and is saved at once.
 */
export function AppearanceChoices({ ref, legendClassName, choiceClassName, iconSize = 18 }: ChoicesProps) {
  const appearance = useAppearance();
  return (
    <fieldset ref={ref}>
      <legend className={cn("px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground", legendClassName)}>Appearance</legend>
      {APPEARANCES.map(({ value, label }) => (
        <label
          key={value}
          className={cn(
            "relative flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[7px] p-2 hover:bg-hover has-checked:bg-hover has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-foreground touch:min-h-11",
            choiceClassName,
          )}
        >
          <input
            type="radio"
            name="appearance"
            value={value}
            checked={appearance === value}
            onChange={() => chooseAppearance(value)}
            className="peer absolute size-px opacity-0 [clip-path:inset(50%)]"
          />
          <NavigationIcon slot={value} size={iconSize} className={cn("shrink-0", iconSize === 18 ? "size-[18px]" : "size-6")} />
          <span>{label}</span>
          <CheckCircle className="invisible ml-auto size-[18px] shrink-0 peer-checked:visible" />
        </label>
      ))}
    </fieldset>
  );
}
