-- Duplicate upload detection: SHA-256 of the normalized document body.
-- Not unique, so the check can be turned off (DUPLICATE_CHECK=off) for testing.
-- Rows saved before this migration are hashed lazily by the Worker.
ALTER TABLE documents ADD COLUMN content_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents (content_hash);
