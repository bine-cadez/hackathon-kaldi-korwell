-- Who uploaded a document, and the original file kept in R2 next to the markdown.
-- documents.created_at is already the upload time.
-- uploaded_by is the verified Cloudflare Access email (NULL in shared-password mode).
-- source_* describe the uploaded file at R2 key source_key (NULL for pasted text).
-- ADD COLUMN is not idempotent; do not re-run this file by hand after it succeeds.

ALTER TABLE documents ADD COLUMN uploaded_by TEXT;
ALTER TABLE documents ADD COLUMN source_key TEXT;
ALTER TABLE documents ADD COLUMN source_filename TEXT;
ALTER TABLE documents ADD COLUMN source_content_type TEXT;
ALTER TABLE documents ADD COLUMN source_size INTEGER;
