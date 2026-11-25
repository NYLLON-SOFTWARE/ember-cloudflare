-- Waveforms of sounds (scope "room" in src/migrations.ts): how loud a file is along its length, as 100
-- levels from 0 to 100, which its uploader's browser works out as it starts the upload (`NewUpload.waveform`
-- in @ember/protocol). `waveform` holds them as JSON, and the message the file is posted as keeps them if
-- the file is a sound, for its player to draw (src/files/blobs.ts `attachedFile`).
ALTER TABLE blobs ADD COLUMN waveform TEXT;
