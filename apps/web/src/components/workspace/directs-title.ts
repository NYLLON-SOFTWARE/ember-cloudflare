import { createContext } from "react";

// Kept apart from the DMs list (directs-pane.tsx), which loads with the pages few visits need, so a phone's DMs
// page can say so without bringing the list into the app's script.

/**
 * Whether the DMs list heads itself "Direct messages", with New direct message beside it, or leaves both
 * to the page around it on phones, as a phone's header and its compose button have them, keeping only the
 * title, for screen readers.
 */
export const DirectsTitleContext = createContext(true);
