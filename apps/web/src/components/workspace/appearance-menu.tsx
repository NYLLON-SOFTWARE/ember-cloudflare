import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Appearance, saveAppearance, savedAppearance, watchAppearance } from "@/lib/appearance";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function AppearanceMenu() {
  const [appearance, setAppearance] = useState<Appearance>(savedAppearance);
  useEffect(() => watchAppearance(setAppearance), []);

  const Current = OPTIONS.find((o) => o.value === appearance)!.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="mt-auto flex size-9 items-center justify-center rounded-full border text-muted-foreground hover:bg-hover hover:text-foreground data-[state=open]:bg-hover data-[state=open]:text-foreground max-md:size-11"
        aria-label="Appearance"
        title="Appearance"
      >
        <Current className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-[190px] rounded-xl p-2">
        <DropdownMenuLabel className="px-2 pt-1 pb-2 text-xs font-semibold text-muted-foreground">Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={appearance}
          onValueChange={(value) => {
            saveAppearance(value as Appearance);
            setAppearance(value as Appearance);
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              className="group min-h-10 gap-2.5 rounded-[7px] p-2 data-[state=checked]:bg-hover [&>span:first-child]:hidden"
            >
              <Icon className="size-[18px]" />
              {label}
              <Check className="ml-auto size-[18px] opacity-0 group-data-[state=checked]:opacity-100" />
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
