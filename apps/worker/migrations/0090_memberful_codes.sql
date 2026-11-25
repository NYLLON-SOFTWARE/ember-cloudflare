-- The codes Ember emails Memberful's members to sign in with on its own sign-in page, kept by the
-- Workspace (scope "workspace" in src/migrations.ts). An address has one at a time, the one emailed last,
-- which works for 15 minutes, for 5 tries, and only for the Memberful site it was emailed for, so that
-- another site's keys end it. Signing in with it deletes it. Ember emails one only to an address the
-- site's admin API finds a member with, and asking for one counts in email_link_requests, as asking for
-- a link to join or a code to reset a password does, since all of them have Ember email an address.
CREATE TABLE IF NOT EXISTS memberful_codes (
  -- The address it was emailed to, in lowercase, so that its case keeps no code of its own.
  email_address TEXT PRIMARY KEY,
  -- The code's HMAC under SESSION_SECRET, as a session token's is kept, since the code alone, with the
  -- address, signs its member in.
  code_digest TEXT NOT NULL,
  -- The origin of the Memberful site whose member has the address.
  site TEXT NOT NULL,
  -- When it was emailed, and when it stops working.
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  -- How many times it's been tried.
  attempts INTEGER NOT NULL DEFAULT 0
);
-- Saving a code deletes, through this, the codes that stopped working, which nobody used.
CREATE INDEX IF NOT EXISTS index_memberful_codes_on_expires_at ON memberful_codes (expires_at);
