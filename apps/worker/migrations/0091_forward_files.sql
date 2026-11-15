-- The file a forward copied (scope "room", src/forwards.ts): its original's file id when it was recorded, so a
-- forward keeps its copy only while its original has that file, and loses it once the original has another, as a
-- bot giving its message a new file makes the copy out of date, whatever the two files' names and sizes.
ALTER TABLE forwards ADD COLUMN file_id TEXT;
