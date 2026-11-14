-- The workspace's profile fields, which its administrators define on workspace settings and people
-- fill in on their profile, kept by the Workspace (scope "workspace" in src/migrations.ts): a name,
-- the choices it takes as a JSON list, or null for free text, and where it comes in the profile. At
-- most 10 fields a workspace, which the Worker counts.
CREATE TABLE profile_fields (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  options TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- What each person saved for each field, "" never saved: clearing takes the row out. Deleting a field
-- takes its values with it, in the same batch, which SQLite only does itself with PRAGMA
-- foreign_keys on, so this points nowhere.
CREATE TABLE profile_field_values (
  field_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (field_id, user_id)
);
CREATE INDEX profile_field_values_by_user ON profile_field_values (user_id);
