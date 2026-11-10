-- Single sign-on with an OpenID Connect provider (src/sso.ts), kept by the Workspace (scope "workspace" in
-- src/migrations.ts).
--
-- Which sessions an account elsewhere signed in: its issuer, and, for an account at a single sign-on
-- provider, the provider's session it came from (OpenID Connect's `sid`), so that a back-channel logout,
-- which names either the person or that session there, ends just those, and a provider that no longer
-- takes someone's refresh token ends theirs. Null for the sessions signed in any other way, and for those
-- from before.
ALTER TABLE sessions ADD COLUMN identity_issuer TEXT;
ALTER TABLE sessions ADD COLUMN identity_sid TEXT;
CREATE INDEX IF NOT EXISTS index_sessions_on_identity_issuer_and_identity_sid ON sessions (identity_issuer, identity_sid);

-- The refresh token a single sign-on provider gave for each account linked at it, sealed under
-- SESSION_SECRET, with which the Workspace asks the provider again, every hour, whether the account still
-- lets its person in, and when it next asks, in milliseconds since the epoch. Null for an account the
-- provider gave none for, and for those at a Memberful site, which the Workspace checks with its admin
-- API instead (migration 0038).
ALTER TABLE identities ADD COLUMN refresh_token TEXT;
ALTER TABLE identities ADD COLUMN refresh_due_at INTEGER;
CREATE INDEX IF NOT EXISTS index_identities_on_refresh_due_at ON identities (refresh_due_at);

-- When the person proved their email address is theirs, by joining with a link Ember emailed to it, or
-- null for one nobody proved, as an address someone typed when they joined is, or one they've changed
-- since, which saving their profile forgets it for. A single sign-on provider that says it verified an
-- address links its account to someone here by it only while this says theirs is proven too.
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
