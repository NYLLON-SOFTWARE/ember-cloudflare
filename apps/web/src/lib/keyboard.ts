/** Phones and tablets: their on-screen keyboards have no Shift+Enter. */
export const hasTouchKeyboard = () => matchMedia("(pointer: coarse)").matches;

/** Ctrl+K, or Cmd+K on a Mac, which opens the Link field of Lexxy's toolbar (its `data-hotkey="cmd+k ctrl+k"`). */
export function opensLink(event: KeyboardEvent): boolean {
  return event.key.toLowerCase() === "k" && event.ctrlKey !== event.metaKey && !event.altKey && !event.shiftKey;
}

/**
 * Whether a keypress in a message's editor should send it, as ember-rust's composer_controller.js
 * decides: Enter sends and Shift+Enter starts a new line, except on touch screens, where Enter has
 * to start the new line and the Send button sends, and while the formatting toolbar is open, when
 * Enter starts a new paragraph. Cmd/Ctrl+Enter sends everywhere.
 *
 * ember-rust treats any touch-capable device that way, and doesn't send on Cmd/Ctrl+Enter there
 * either; this checks the primary pointer instead, so a laptop with a touchscreen still sends on Enter.
 */
export function sendsMessage(event: KeyboardEvent, { toolbarOpen = false } = {}): boolean {
  if (event.key !== "Enter" || event.isComposing) return false;
  if (event.metaKey || event.ctrlKey) return true;
  return !event.shiftKey && !toolbarOpen && !hasTouchKeyboard();
}
