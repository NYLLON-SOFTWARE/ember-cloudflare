import { useEffect, useState, type ReactNode } from "react";
import { loadRarePages, peekRarePages, type RarePages } from "@/components/workspace/rare-pages";

/**
 * What `show` makes of the pages before a workspace but for signing in, which each visit needs at most once:
 * setting Ember up, joining it by a link, an invitation or an email address, and resetting a password. They
 * load with the pages few visits need (pages.ts), and the page's background shows until then, or a word that
 * they couldn't load, as when Ember was updated since this page loaded.
 */
export function SignedOutPage({ show }: { show: (pages: RarePages) => ReactNode }) {
  const [pages, setPages] = useState(peekRarePages);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (pages) return;
    let current = true;
    loadRarePages().then(
      (loaded) => current && setPages(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [pages]);
  if (pages) return show(pages);
  return (
    <main aria-busy={!failed} className="grid min-h-dvh place-items-center bg-surface p-4 text-center text-muted-foreground">
      {failed && <p role="alert">This page couldn’t load. Reload to try again.</p>}
    </main>
  );
}
