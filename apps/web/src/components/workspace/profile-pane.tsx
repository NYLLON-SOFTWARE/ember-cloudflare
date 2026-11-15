import { createContext, useContext, type MouseEvent } from "react";
import type { User, UserId } from "@ember/protocol";

// Someone's profile beside the conversation shown, as Slack opens one from an avatar or a name: in the
// column beside a room, in a thread's place when one is open there, or in Activity's last pane. Their page,
// `/users/<id>`, stays for links to it.

export interface ProfilePane {
  /** Whose profile is open beside the conversation shown, or null. */
  userId: UserId | null;
  /** Opens someone's profile beside the conversation shown, in the place of anyone else's. */
  open: (userId: UserId) => void;
  close: () => void;
  /** Starts a DM with someone, or opens the one you have, and goes there, settling with whether it did. */
  startDirect: (person: User) => Promise<boolean>;
}

/** What the address of a room or Activity names the person whose profile is open beside it by: `?profile=<id>`. */
export const PROFILE_PARAM = "profile";

/** The profile pane of the page shown, or null on a page that has none, where an avatar links to someone's page. */
export const ProfilePaneContext = createContext<ProfilePane | null>(null);

export const useProfilePane = () => useContext(ProfilePaneContext);

/** The person a link's address names, when it's someone's page. */
export function personOfLink(link: HTMLAnchorElement): UserId | null {
  if (link.origin !== location.origin) return null;
  const match = link.pathname.match(/^\/users\/([^/]+)$/);
  if (!match || match[1] === "me") return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return null;
  }
}

/**
 * Opens the profile pane in place of following a link to someone's page that `event`'s click is on, as
 * Slack's avatars and names do, when there's a pane to open it in, and the link is followed in place.
 */
export function opensProfile(pane: ProfilePane | null, event: MouseEvent): void {
  if (!pane || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = (event.target as Element).closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("data-full-page")) return;
  const userId = personOfLink(link);
  if (userId === null) return;
  event.preventDefault();
  opener = link;
  pane.open(userId);
}

/** The link the profile pane opened from last, for focus to return to as it closes. */
let opener: Element | null = null;

/** Takes the link the profile pane opened from last, which focus returns to as it closes (profile-panel.tsx). */
export function takeOpener(): Element | null {
  const from = opener;
  opener = null;
  return from;
}
