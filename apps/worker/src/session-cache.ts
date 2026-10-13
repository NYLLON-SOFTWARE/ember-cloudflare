/**
 * The sessions the Workspace has used lately, by their token's digest, so most requests skip the
 * database. Only the Workspace changes sessions, so the cache stays current as long as everything
 * that ends one goes through `end`.
 */
export class SessionCache<Session> {
  /** Least recently used first, since a Map keeps insertion order. */
  private readonly sessions = new Map<string, Session>();
  /** Counts endings, so a lookup that overlapped one isn't kept: on D1, queries interleave. */
  private endings = 0;

  constructor(private readonly limit: number) {}

  /** The session `digest` names, from memory or else from `lookUp`, which is kept if it finds one. */
  async get(digest: string, lookUp: () => Promise<Session | null>): Promise<Session | null> {
    const cached = this.sessions.get(digest);
    if (cached) {
      this.remember(digest, cached);
      return cached;
    }
    const endings = this.endings;
    const session = await lookUp();
    // A session that ended during the lookup may have been read before it went.
    if (session && endings === this.endings) this.remember(digest, session);
    return session;
  }

  /** Keeps `session` as the most recently used, forgetting the least recently used past the limit. */
  remember(digest: string, session: Session): void {
    this.sessions.delete(digest);
    this.sessions.set(digest, session);
    if (this.sessions.size > this.limit) this.sessions.delete(this.sessions.keys().next().value!);
  }

  /** Ends the session `digest` names with `end`, forgetting it even if `end` fails, since it may have ended anyway. */
  async end(digest: string, end: () => Promise<void>): Promise<void> {
    try {
      await end();
    } finally {
      this.endings++;
      this.sessions.delete(digest);
    }
  }
}
