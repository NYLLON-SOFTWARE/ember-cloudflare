import { createContext } from "react";
import { WORKSPACE_SETTINGS_PATH, type Route } from "@/hooks/use-route";

// Community settings: the pages that set the workspace up share a layout whose column of links to them
// takes the conversations' place, and workspace settings show one of their sections at a time, the one
// the address's fragment names: General, Rooms and permissions, Membership, and Domain settings, where
// administrators give Ember a custom domain, AI assistant, where they set up Ember AI and its agents,
// whose pages are part of it, and Huddles, where they turn huddles on.

/** The sections of community settings, by their ids. */
export type SettingsSection =
  | "community-settings"
  | "channel-settings"
  | "membership-settings"
  | "domain-settings"
  | "chat-bots"
  | "assistant-settings"
  | "huddles-settings"
  | "custom-styles";

const WORKSPACE_SECTIONS = ["community-settings", "channel-settings", "membership-settings", "domain-settings", "assistant-settings", "huddles-settings"] as const;

/** Workspace settings' own sections, which `/account/edit` shows one at a time. */
export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

/** The address of one of workspace settings' sections. */
export const workspaceSectionPath = (section: WorkspaceSection) => `${WORKSPACE_SETTINGS_PATH}#${section}`;

/** The section of workspace settings an address's fragment shows: the first, unless it names another. */
export function workspaceSectionOf(hash: string): WorkspaceSection {
  return WORKSPACE_SECTIONS.find((section) => `#${section}` === hash) ?? "community-settings";
}

/** The section of community settings a page is part of, or null for any other page. */
export function settingsSectionOf(route: Route, hash: string): SettingsSection | null {
  switch (route.page) {
    case "workspace-settings":
      return workspaceSectionOf(hash);
    case "new-room":
    case "room-settings":
      return "channel-settings";
    case "bots":
    case "new-bot":
    case "bot-settings":
      return "chat-bots";
    case "new-agent":
    case "agent-settings":
    case "new-app":
    case "app-settings":
      return "assistant-settings";
    case "custom-styles":
      return "custom-styles";
    default:
      return null;
  }
}

/** On a page of community settings, its section, and whether whoever's looking administers the workspace. */
export interface SettingsPlace {
  section: SettingsSection;
  administrator: boolean;
}

/** The page of community settings shown, which the layout around it follows, or null on any other page. */
export const SettingsLayout = createContext<SettingsPlace | null>(null);
