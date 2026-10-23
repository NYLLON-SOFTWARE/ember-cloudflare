-- When each person dismissed the welcome card, kept by the Workspace (scope "workspace" in
-- src/migrations.ts), or null while they haven't. ember-rust shows the card to everyone in the
-- workspace's first room and has no way to dismiss it; here only administrators are given it, and each
-- can dismiss it for good, on every device they sign in on.
ALTER TABLE users ADD COLUMN invitation_dismissed_at TEXT;
