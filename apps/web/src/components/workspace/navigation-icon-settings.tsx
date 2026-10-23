import { useRef } from "react";
import { DEFAULT_NAVIGATION_ICONS, NAVIGATION_SLOTS, type NavigationIconChanges, type NavigationSlot, type RoomIconChoice } from "@ember/protocol";
import { iconLabel } from "@/components/icons/room-icon-label";
import { useAccount } from "@/hooks/use-account";
import { IconDialog, IconTrigger, type IconDialogHandle } from "./icon-picker";
import { SlotIcon } from "./navigation-icon";

/** What each slot is called, as ember-rust's `NAVIGATION_ICONS` (helpers/icons.rs, pull request #24) calls it. */
const SLOT_LABELS: Record<NavigationSlot, string> = {
  home: "Home",
  dms: "DMs",
  activity: "Activity",
  search: "Search",
  admin: "Admin",
  light: "Light mode",
  dark: "Dark mode",
  system: "System appearance",
};

interface Props {
  /** The slots given another icon here that Save changes hasn't saved yet: each an icon, or "" for its default. */
  changes: NavigationIconChanges;
  onChange: (slot: NavigationSlot, icon: RoomIconChoice) => void;
  /** While the form saves. */
  disabled: boolean;
  /** Where the catalog comes from. */
  catalogUrl?: string;
}

/**
 * ember-rust's accounts/_navigation_icons.html (pull request #24, d49621e): a picker for each of the
 * rail's buttons and the appearance modes, two to a row, or one on screens up to 600px wide, which open
 * one dialog of icons. Save changes saves them with the community's name.
 */
export function NavigationIconSettings({ changes, onChange, disabled, catalogUrl }: Props) {
  const { navigationIcons } = useAccount();
  const dialog = useRef<IconDialogHandle>(null);
  return (
    // `.mb-navigation-icons`.
    <section aria-labelledby="navigation-icons-heading" className="border-t pt-6">
      <header className="mb-4">
        <h2 id="navigation-icons-heading" className="mb-1.5 text-[17px] font-semibold">
          Navigation icons
        </h2>
        <p className="text-[13px] text-muted-foreground">Choose the icons in your community’s left navigation. Changes apply to everyone.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 upto-600px:grid-cols-1">
        {NAVIGATION_SLOTS.map((slot) => {
          const changed = changes[slot];
          const icon = changed === undefined ? (navigationIcons[slot] ?? null) : changed || null;
          return (
            <IconTrigger
              key={slot}
              label={`Choose ${SLOT_LABELS[slot]} icon`}
              preview={<SlotIcon slot={slot} icon={icon} size={23} className="size-[23px]" />}
              title={SLOT_LABELS[slot]}
              subtitle={icon ? iconLabel(icon, "navigation") : "Default icon"}
              disabled={disabled}
              onOpen={(trigger) =>
                dialog.current?.open({
                  icon,
                  defaultIcon: DEFAULT_NAVIGATION_ICONS[slot],
                  defaultLabel: "Default icon",
                  // The default's own icon is the default, as ember-rust saves it.
                  apply: (chosen) => onChange(slot, chosen === DEFAULT_NAVIGATION_ICONS[slot] ? "" : (chosen ?? "")),
                  trigger,
                })
              }
            />
          );
        })}
      </div>
      <IconDialog
        ref={dialog}
        context="navigation"
        title="Choose a navigation icon"
        description="Recommendations for your navigation buttons and appearance modes."
        group="Navigation icons"
        catalogUrl={catalogUrl}
      />
    </section>
  );
}
