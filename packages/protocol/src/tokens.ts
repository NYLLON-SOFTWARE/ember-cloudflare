// Personal access tokens, as `/api/account/tokens` takes and lists them, and the MCP server takes one
// as a bearer token. Each one is a person's, and acts in their place, within their memberships.

/** The most characters a token's name can have, as a room's can. */
export const MAX_TOKEN_NAME_LENGTH = 48;

/** One of your API tokens, as the API tokens section of your profile lists it: never its secret. */
export interface ApiToken {
  id: string;
  name: string;
  /** When it was made, in milliseconds since the epoch. */
  createdAt: number;
  /** When a request last opened with it, or null for never, kept only to the minute. */
  lastUsedAt: number | null;
  /** When it was revoked, or null while it still works. */
  revokedAt: number | null;
}

/** What `GET /api/account/tokens` answers: your tokens, newest first. */
export interface ApiTokens {
  tokens: ApiToken[];
}

/** What `POST /api/account/tokens` takes: a name to know the token by. */
export interface NewApiToken {
  name: string;
}

/**
 * What `POST /api/account/tokens` answers: the token as it's listed, with `token`, its secret, which is
 * shown once, now, and never again.
 */
export interface ApiTokenCreated extends ApiToken {
  token: string;
}

/**
 * Parses what `POST /api/account/tokens` takes. Returns why it's refused instead: a name has to have
 * more than spaces, and no more than `MAX_TOKEN_NAME_LENGTH` characters. It's saved trimmed.
 */
export function parseNewApiToken(data: unknown): NewApiToken | string {
  const name = typeof (data as Record<string, unknown>)?.name === "string" ? ((data as Record<string, unknown>).name as string).trim() : null;
  if (!name) return "A name is needed to know the token by";
  if (name.length > MAX_TOKEN_NAME_LENGTH) return `Name can't be longer than ${MAX_TOKEN_NAME_LENGTH} characters`;
  return { name };
}
