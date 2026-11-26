import { useEffect } from "react";

/** What a tab is called besides the page: the campaign's chat. */
const BRAND = "Team Lopez";

/** Names the tab `title` while the page is open, as `title · Team Lopez`; null leaves it as it is, as while a page loads. */
export function useTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;
    const before = document.title;
    document.title = title === BRAND || title.endsWith(` · ${BRAND}`) ? title : `${title} · ${BRAND}`;
    return () => void (document.title = before);
  }, [title]);
}
