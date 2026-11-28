import { useLayoutEffect } from "react";

/**
 * Makes the workspace's logo at `logo` every page's icon and Apple touch icon, and marks the page's body
 * `account-has-logo` for custom CSS to go by, as Campfire's `body_classes` does. The icon is the logo's
 * 192-pixel variant rather than the 512-pixel one, since a full-size icon delays a room's largest paint,
 * as index.html's 48-pixel one is scaled down for. While there's no logo, pages keep index.html's icons.
 */
export function useAccountLogo(logo: string | null): void {
  useLayoutEffect(() => {
    if (!logo) return;
    document.body.classList.add("account-has-logo");
    // Each of index.html's icons, its PNG and its SVG, since a browser shows whichever it prefers.
    const icons = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')].map((link) => pointLink(link, `${logo}&size=small`));
    const touchIcon = document.head.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    const restore = [...icons, ...(touchIcon ? [pointLink(touchIcon, logo)] : [])];
    return () => {
      document.body.classList.remove("account-has-logo");
      for (const pointBack of restore) pointBack();
    };
  }, [logo]);
}

/**
 * Points `link` at the logo's PNG at `href`, without the size index.html gives Ember's own icon,
 * answering what points it back.
 */
function pointLink(link: HTMLLinkElement, href: string): () => void {
  const stock = (["href", "type", "sizes"] as const).map((name) => [name, link.getAttribute(name)] as const);
  link.setAttribute("href", href);
  if (link.hasAttribute("type")) link.setAttribute("type", "image/png");
  link.removeAttribute("sizes");
  return () => {
    for (const [name, value] of stock) if (value !== null) link.setAttribute(name, value);
  };
}
