import { useLayoutEffect, useRef, type ComponentType } from "react";
import { BrainElectricity, Group, Hashtag, Headset, Internet, Palette, Settings, Sparks } from "@/components/icons/iconoir";
import { PageLink } from "@/components/page-link";
import { BOTS_PATH, CUSTOM_STYLES_PATH } from "@/hooks/use-route";
import { cn } from "@/lib/utils";
import { workspaceSectionPath, type SettingsPlace, type SettingsSection } from "./settings-navigation";

// The links to community settings' sections (settings-navigation.tsx), which load with the settings pages.

interface SectionLink {
  section: SettingsSection;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
}

const LINKS: SectionLink[] = [
  { section: "community-settings", href: workspaceSectionPath("community-settings"), icon: Settings, label: "General" },
  { section: "channel-settings", href: workspaceSectionPath("channel-settings"), icon: Hashtag, label: "Rooms and permissions" },
  { section: "membership-settings", href: workspaceSectionPath("membership-settings"), icon: Group, label: "Membership" },
];

/** And the sections only administrators use. */
const ADMINISTRATOR_LINKS: SectionLink[] = [
  { section: "domain-settings", href: workspaceSectionPath("domain-settings"), icon: Internet, label: "Domain settings" },
  { section: "chat-bots", href: BOTS_PATH, icon: BrainElectricity, label: "Chat bots" },
  { section: "assistant-settings", href: workspaceSectionPath("assistant-settings"), icon: Sparks, label: "AI assistant" },
  { section: "huddles-settings", href: workspaceSectionPath("huddles-settings"), icon: Headset, label: "Huddles" },
  { section: "custom-styles", href: CUSTOM_STYLES_PATH, icon: Palette, label: "Custom styles" },
];

/**
 * A link's look: 13px muted text beside its 18px icon, on the surface under a pointer, and in ink on the
 * hover color, in bold, for the current section. At 900px and below the links share the strip, centered,
 * and at 500px and below each icon sits over its label, in 11px text.
 */
const LINK = cn(
  "mb-2 flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-[11px] text-[13px] leading-[1.4] text-muted-foreground",
  "hover:bg-surface hover:text-foreground aria-[current=page]:bg-hover aria-[current=page]:font-semibold aria-[current=page]:text-foreground",
  "max-md:m-0 max-md:flex-[1_0_auto] max-md:justify-center max-md:px-2 max-md:py-2.5 max-md:text-center",
  "upto-500px:flex-col upto-500px:gap-[5px] upto-500px:text-[11px]",
);

/**
 * The links to community settings' sections, the current one marked: a 244px column beside the page,
 * or at 900px and below, a strip under the header that scrolls sideways when they don't all fit, keeping
 * the current one in view. Domain settings, Chat bots, AI assistant, Huddles and Custom styles are for
 * administrators alone.
 */
export function SettingsNavigation({ section, administrator }: SettingsPlace) {
  const navigation = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const strip = navigation.current;
    if (strip && strip.scrollWidth > strip.clientWidth) strip.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);
  return (
    <nav
      ref={navigation}
      aria-label="Community settings"
      className={cn(
        "min-h-0 overflow-y-auto border-r bg-background px-4 py-9",
        "max-md:flex max-md:gap-1.5 max-md:overflow-x-auto max-md:border-r-0 max-md:border-b max-md:py-2 max-md:pr-[max(12px,env(safe-area-inset-right))] max-md:pl-[max(12px,env(safe-area-inset-left))]",
      )}
    >
      {(administrator ? [...LINKS, ...ADMINISTRATOR_LINKS] : LINKS).map(({ section: linked, href, icon: Icon, label }) => (
        <PageLink key={linked} href={href} aria-current={linked === section ? "page" : undefined} className={LINK}>
          <Icon className="size-[18px] shrink-0" />
          <span>{label}</span>
        </PageLink>
      ))}
    </nav>
  );
}
