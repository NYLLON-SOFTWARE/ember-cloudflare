-- Personal access tokens, kept by the Workspace (scope "workspace" in src/migrations.ts): each one a
-- person made for an app of their own, which opens the MCP server in their place. Only a digest of the
-- token is kept (src/auth.ts), as a session's cookie's is, so a leaked database holds none; the token
-- itself was shown once, `pat_` first, when it was made.
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  name TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS index_api_tokens_on_token_digest ON api_tokens (token_digest);
CREATE INDEX IF NOT EXISTS index_api_tokens_on_user_id ON api_tokens (user_id);
