import type { ComponentType } from "react";
import type { IconoirIconProps } from "@/components/icons/iconoir";

interface Props {
  Icon: ComponentType<IconoirIconProps>;
  title: string;
}

/**
 * What a list column says when it has nothing to list, as the DMs page's list and Activity's do: an icon,
 * muted, over a title alone, centered in the column.
 */
export function ListEmptyState({ Icon, title }: Props) {
  return (
    <div className="grid justify-items-center gap-1 px-6 pt-10 pb-6 text-center text-muted-foreground">
      <Icon aria-hidden="true" className="mb-2 size-8" />
      <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
    </div>
  );
}
