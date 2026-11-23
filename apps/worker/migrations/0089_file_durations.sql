-- Lengths of videos (scope "room" in src/migrations.ts): how long a file plays, in seconds, which its
-- uploader's browser reads from it as it starts the upload (`NewUpload.duration` in @ember/protocol). The
-- message the file is posted as keeps it if the file is a video, for its player to show without loading the
-- video (src/files/blobs.ts `attachedFile`).
ALTER TABLE blobs ADD COLUMN duration REAL;
