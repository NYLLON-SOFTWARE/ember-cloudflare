-- The host each push subscription was saved at, which ember-rust doesn't keep, kept by the Workspace
-- (scope "workspace" in src/migrations.ts). A subscription belongs to the service worker of one
-- address, so a browser that turns notifications on at Ember's custom domain still has the one it saved
-- at the address it used before, and would get every push twice: saving one at the custom domain
-- forgets those the same browser saved at other hosts. Subscriptions saved before this have none.
ALTER TABLE push_subscriptions ADD COLUMN host TEXT;
