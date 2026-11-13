-- Author plus an FTS5 index over title, author, and body.
-- unicode61 remove_diacritics 2 folds č/š/ž onto c/s/z in both rows and queries.
-- Wrangler applies a migration file once, in one batch. The FTS objects use
-- IF NOT EXISTS and the backfill skips ids already indexed. ADD COLUMN is not
-- itself idempotent; do not re-run this file by hand after it succeeds.

ALTER TABLE documents ADD COLUMN author TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  author,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS documents_fts_insert
AFTER INSERT ON documents
BEGIN
  INSERT INTO documents_fts(document_id, title, author, body)
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body);
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_delete
AFTER DELETE ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS documents_fts_update
AFTER UPDATE ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
  INSERT INTO documents_fts(document_id, title, author, body)
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body);
END;

INSERT INTO documents_fts(document_id, title, author, body)
SELECT d.id, d.title, COALESCE(d.author, ''), d.body
FROM documents AS d
WHERE NOT EXISTS (
  SELECT 1 FROM documents_fts AS f WHERE f.document_id = d.id
);
