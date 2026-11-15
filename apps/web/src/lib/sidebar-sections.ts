// Which of the Home sidebar's sections, Starred and Rooms, are folded, as this browser last left them,
// whoever signs in, as Slack remembers a folded section.

/** A section of the Home sidebar that folds. */
export type SidebarSection = "starred" | "rooms";

const keyOf = (section: SidebarSection) => `ember:sidebar-folded:${section}`;

/** Whether `section` was left folded in this browser. */
export function isFolded(section: SidebarSection): boolean {
  try {
    return localStorage.getItem(keyOf(section)) === "true";
  } catch {
    return false;
  }
}

/** Remembers whether `section` is folded. */
export function rememberFolded(section: SidebarSection, folded: boolean): void {
  try {
    if (folded) localStorage.setItem(keyOf(section), "true");
    else localStorage.removeItem(keyOf(section));
  } catch {
    // Storage can be refused, and then every section opens unfolded.
  }
}
