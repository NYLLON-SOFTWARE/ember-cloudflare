-- Who a workspace names in groups one mention stands for, kept by the Workspace (scope "workspace" in
-- src/migrations.ts). The name is stored lowercased, as people's names are compared (src/lib/people.ts
-- in the web app folds only ASCII letters), so SQLite's case-sensitive UNIQUE keeps two names apart
-- whatever capitals they're written with. A mention of the group notifies everyone in it, so its
-- members are the people whose ids a message's mentions list gains when the group is named.
CREATE TABLE IF NOT EXISTS user_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_group_members (
  group_id TEXT NOT NULL REFERENCES user_groups (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS index_user_group_members_on_user_id ON user_group_members (user_id);
