-- The codes Ember emails the address a Memberful account has, for someone here to connect that account to
-- theirs from their profile, kept by the Workspace (scope "workspace" in src/migrations.ts). A person has
-- one at a time, the one emailed last, which works for 15 minutes, for 5 tries, only with the address it
-- was emailed to and the Memberful site whose member has it, and only while their password is still the
-- one that checked out as they asked for it, as a connection started on Memberful's page does
-- (pending_identities), so that a new one, however it's given, ends it. Connecting with it deletes it.
-- Ember emails one only to an address the site's admin API finds a member with, and asking for one counts
-- in email_link_requests, as asking for a code to sign in with Memberful does.
CREATE TABLE IF NOT EXISTS memberful_connection_codes (
  user_id TEXT PRIMARY KEY REFERENCES users (id),
  -- The code's HMAC under SESSION_SECRET, as a session token's is kept.
  code_digest TEXT NOT NULL,
  -- The address it was emailed to, in lowercase, so that its case keeps no code of its own, and the
  -- origin of the Memberful site whose member has it.
  email_address TEXT NOT NULL,
  site TEXT NOT NULL,
  -- The digest of the password that checked out, as users.password_digest had it, or '' without one.
  password_digest TEXT NOT NULL,
  -- When it was emailed, and when it stops working.
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- How many times it's been tried.
  attempts INTEGER NOT NULL DEFAULT 0
);
-- Saving a code deletes, through this, the codes that stopped working, which nobody used.
CREATE INDEX IF NOT EXISTS index_memberful_connection_codes_on_expires_at ON memberful_connection_codes (expires_at);
