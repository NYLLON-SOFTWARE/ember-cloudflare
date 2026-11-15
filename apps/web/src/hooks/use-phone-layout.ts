import { useMediaQuery } from "./use-media-query";

/**
 * The phone layout, below 900px wide (`max-md`), where pages take the whole screen one at a time, as
 * in Slack's phone app: a tab bar along the bottom goes between Home, DMs, Activity and Files, and a
 * conversation, a thread or someone's profile opens over them, with Back at the top.
 */
export const PHONE_LAYOUT = "(width < 56.3125rem)";

/** Whether the page uses the phone layout. */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_LAYOUT);
}
