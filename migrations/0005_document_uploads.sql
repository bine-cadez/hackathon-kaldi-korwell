-- Who uploaded each document, the original file, and a Slovenian sort key.
-- Like 0002, the app detects these columns and keeps working before this runs:
-- PR previews share production D1.
-- ADD COLUMN is not idempotent; do not re-run this file by hand after it succeeds.

-- Cloudflare Access identity of the uploader (email and stable subject id).
-- NULL for documents saved in shared-password mode, where nobody is identified.
ALTER TABLE documents ADD COLUMN uploaded_by TEXT;
ALTER TABLE documents ADD COLUMN uploaded_by_id TEXT;

-- The uploaded file as the person picked it. NULL for pasted text.
ALTER TABLE documents ADD COLUMN file_name TEXT;
ALTER TABLE documents ADD COLUMN file_size INTEGER;
ALTER TABLE documents ADD COLUMN file_type TEXT;

-- Sort key for "Title A–Z": SQLite compares bytes, so Č Š Ž would sort after Z.
-- New rows get shared/utils/text.ts slovenianSortKey(title). The backfill below
-- applies the same rules for Slovenian letters and the common accents.
ALTER TABLE documents ADD COLUMN title_sort TEXT;

UPDATE documents SET title_sort = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(lower(trim(title)), 'Č', 'c{'), 'č', 'c{'), 'Ć', 'c|'), 'ć', 'c|'), 'Đ', 'd{'), 'đ', 'd{'), 'Š', 's{'), 'š', 's{'), 'Ž', 'z{'), 'ž', 'z{'), 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'Á', 'a'), 'À', 'a'), 'Â', 'a'), 'Ä', 'a'), 'é', 'e'), 'è', 'e'), 'ê', 'e'), 'ë', 'e'), 'ě', 'e'), 'É', 'e'), 'È', 'e'), 'Ê', 'e'), 'Ë', 'e'), 'Ě', 'e'), 'í', 'i'), 'ì', 'i'), 'î', 'i'), 'ï', 'i'), 'Í', 'i'), 'Ì', 'i'), 'Î', 'i'), 'Ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o'), 'Ó', 'o'), 'Ò', 'o'), 'Ô', 'o'), 'Ö', 'o'), 'ú', 'u'), 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'Ú', 'u'), 'Ù', 'u'), 'Û', 'u'), 'Ü', 'u')
WHERE title_sort IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_title_sort ON documents (title_sort, created_at);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents (uploaded_by, created_at);
CREATE INDEX IF NOT EXISTS idx_documents_author ON documents (author, created_at);

-- Rebuild the FTS index with the file name, so "porocilo" finds "Poročilo_2024.pdf".
-- file_name goes last so the existing columns keep their positions.
DROP TRIGGER IF EXISTS documents_fts_insert;
DROP TRIGGER IF EXISTS documents_fts_delete;
DROP TRIGGER IF EXISTS documents_fts_update;
DROP TABLE IF EXISTS documents_fts;

CREATE VIRTUAL TABLE documents_fts USING fts5(
  document_id UNINDEXED,
  title,
  author,
  body,
  file_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER documents_fts_insert
AFTER INSERT ON documents
BEGIN
  INSERT INTO documents_fts(document_id, title, author, body, file_name)
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body, COALESCE(new.file_name, ''));
END;

CREATE TRIGGER documents_fts_delete
AFTER DELETE ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
END;

-- Only text the index holds; setting r2_key after a save no longer re-indexes the body.
CREATE TRIGGER documents_fts_update
AFTER UPDATE OF title, author, body, file_name ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
  INSERT INTO documents_fts(document_id, title, author, body, file_name)
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body, COALESCE(new.file_name, ''));
END;

INSERT INTO documents_fts(document_id, title, author, body, file_name)
SELECT d.id, d.title, COALESCE(d.author, ''), d.body, COALESCE(d.file_name, '')
FROM documents AS d;
