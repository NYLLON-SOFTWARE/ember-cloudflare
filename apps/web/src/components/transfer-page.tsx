import { useEffect, useState } from "react";
import { ApiError, signInWithLink } from "@/lib/api";
import { loadPage } from "@/lib/page";
import { takeReturnPath } from "@/lib/return-path";

// ember-rust's sign-in link page (crates/views/templates/sessions/transfers/show.html): an empty page
// whose form submits itself as soon as it's shown (auto_submit_controller.js), signing the browser in
// as whoever the link was made for.

const MAX_RETRY_MS = 15_000;

/**
 * Signs in with the sign-in link `transferId` as soon as it opens, then loads the page this tab was sent
 * to sign in from, or home, as ember-rust redirects there. A link that doesn't work leaves the page
 * blank, as ember-rust's empty 400 answer does, and a request that can't reach Ember, or that Ember
 * fails, is tried again, as the app's first one is.
 */
export function TransferPage({ transferId }: { transferId: string }) {
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const signIn = (attempt: number) =>
      signInWithLink(transferId).then(
        // A new page, so nothing of any session this browser had stays in memory.
        () => !stopped && loadPage(takeReturnPath() ?? "/"),
        (error: unknown) => {
          if (stopped) return;
          if (error instanceof ApiError && error.status < 500) setRefused(true);
          else retry = setTimeout(() => void signIn(attempt + 1), Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt));
        },
      );
    void signIn(0);
    return () => {
      stopped = true;
      clearTimeout(retry);
    };
  }, [transferId]);

  return <main aria-busy={!refused} className="min-h-dvh bg-surface" />;
}
