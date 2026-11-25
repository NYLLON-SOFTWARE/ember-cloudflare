/**
 * How many conversations each site has unread, as each of its pages last said, in its window and those
 * its pages opened, which together make the count on the app's icon. A page's count goes as it leaves or
 * closes, since a page that's back says it again.
 */
export class UnreadCounts<Page> {
  readonly #counts = new Map<Page, { site: string; count: number }>();

  /** Counts `count` as what the page `page`, of the site with id `site`, has unread. */
  set(page: Page, site: string, count: number): void {
    this.#counts.set(page, { site, count });
  }

  /** Forgets what `page` said. */
  drop(page: Page): void {
    this.#counts.delete(page);
  }

  /** Every site's count, each the highest of its pages', since they count the same conversations. */
  total(): number {
    const bySite = new Map<string, number>();
    for (const { site, count } of this.#counts.values()) bySite.set(site, Math.max(count, bySite.get(site) ?? 0));
    return [...bySite.values()].reduce((total, count) => total + count, 0);
  }
}
