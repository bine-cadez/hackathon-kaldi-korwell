-- Library sorting and search over the uploader and file name (0005_document_source.sql).
-- Like 0002 and 0005, the app detects these changes and keeps working before this
-- runs: PR previews share production D1.
-- ADD COLUMN is not idempotent; do not re-run this file by hand after it succeeds.

-- Sort key for "Title A–Z": SQLite compares bytes, so Č Š Ž would sort after Z.
-- New rows get shared/utils/text.ts slovenianSortKey(title). The backfill below
-- applies the same rules for Slovenian letters and the common accents.
ALTER TABLE documents ADD COLUMN title_sort TEXT;

-- Lower-case first, then swap letters a few at a time: one deeply nested
-- replace() overflows SQLite's parser stack.
UPDATE documents SET title_sort = lower(trim(title)) WHERE title_sort IS NULL;
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Č', 'c{'), 'č', 'c{'), 'Ć', 'c|'), 'ć', 'c|'), 'Đ', 'd{');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'đ', 'd{'), 'Š', 's{'), 'š', 's{'), 'Ž', 'z{'), 'ž', 'z{');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'Á', 'a');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'À', 'a'), 'Â', 'a'), 'Ä', 'a'), 'é', 'e'), 'è', 'e');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ê', 'e'), 'ë', 'e'), 'ě', 'e'), 'É', 'e'), 'È', 'e');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ê', 'e'), 'Ë', 'e'), 'Ě', 'e'), 'í', 'i'), 'ì', 'i');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'î', 'i'), 'ï', 'i'), 'Í', 'i'), 'Ì', 'i'), 'Î', 'i');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ó', 'o'), 'Ò', 'o'), 'Ô', 'o'), 'Ö', 'o'), 'ú', 'u');
UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'Ú', 'u'), 'Ù', 'u');
UPDATE documents SET title_sort = replace(replace(title_sort, 'Û', 'u'), 'Ü', 'u');

-- Safety net for rows written without a sort key: older code (PR previews share
-- production D1) or a plain SQL insert. The app sets title_sort itself.
CREATE TRIGGER IF NOT EXISTS documents_title_sort_insert
AFTER INSERT ON documents
WHEN new.title_sort IS NULL
BEGIN
  UPDATE documents SET title_sort = lower(trim(new.title)) WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Č', 'c{'), 'č', 'c{'), 'Ć', 'c|'), 'ć', 'c|'), 'Đ', 'd{') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'đ', 'd{'), 'Š', 's{'), 'š', 's{'), 'Ž', 'z{'), 'ž', 'z{') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'Á', 'a') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'À', 'a'), 'Â', 'a'), 'Ä', 'a'), 'é', 'e'), 'è', 'e') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ê', 'e'), 'ë', 'e'), 'ě', 'e'), 'É', 'e'), 'È', 'e') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ê', 'e'), 'Ë', 'e'), 'Ě', 'e'), 'í', 'i'), 'ì', 'i') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'î', 'i'), 'ï', 'i'), 'Í', 'i'), 'Ì', 'i'), 'Î', 'i') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ó', 'o'), 'Ò', 'o'), 'Ô', 'o'), 'Ö', 'o'), 'ú', 'u') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'Ú', 'u'), 'Ù', 'u') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(title_sort, 'Û', 'u'), 'Ü', 'u') WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS documents_title_sort_update
AFTER UPDATE OF title ON documents
WHEN new.title_sort IS NULL OR new.title_sort = old.title_sort
BEGIN
  UPDATE documents SET title_sort = lower(trim(new.title)) WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Č', 'c{'), 'č', 'c{'), 'Ć', 'c|'), 'ć', 'c|'), 'Đ', 'd{') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'đ', 'd{'), 'Š', 's{'), 'š', 's{'), 'Ž', 'z{'), 'ž', 'z{') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'á', 'a'), 'à', 'a'), 'â', 'a'), 'ä', 'a'), 'Á', 'a') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'À', 'a'), 'Â', 'a'), 'Ä', 'a'), 'é', 'e'), 'è', 'e') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ê', 'e'), 'ë', 'e'), 'ě', 'e'), 'É', 'e'), 'È', 'e') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ê', 'e'), 'Ë', 'e'), 'Ě', 'e'), 'í', 'i'), 'ì', 'i') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'î', 'i'), 'ï', 'i'), 'Í', 'i'), 'Ì', 'i'), 'Î', 'i') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ï', 'i'), 'ó', 'o'), 'ò', 'o'), 'ô', 'o'), 'ö', 'o') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'Ó', 'o'), 'Ò', 'o'), 'Ô', 'o'), 'Ö', 'o'), 'ú', 'u') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(replace(replace(replace(title_sort, 'ù', 'u'), 'û', 'u'), 'ü', 'u'), 'Ú', 'u'), 'Ù', 'u') WHERE id = new.id;
  UPDATE documents SET title_sort = replace(replace(title_sort, 'Û', 'u'), 'Ü', 'u') WHERE id = new.id;
END;

-- The Library's "Title A–Z" sort and its Author and Uploaded by filters.
CREATE INDEX IF NOT EXISTS idx_documents_title_sort ON documents (title_sort, created_at);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents (uploaded_by, created_at);
CREATE INDEX IF NOT EXISTS idx_documents_author ON documents (author, created_at);

-- Rebuild the FTS index with the original file name (documents.source_filename),
-- so "porocilo" finds "Poročilo_2024.pdf". file_name goes last so the existing
-- columns keep their positions.
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
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body, COALESCE(new.source_filename, ''));
END;

CREATE TRIGGER documents_fts_delete
AFTER DELETE ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
END;

-- Only text the index holds; setting r2_key after a save no longer re-indexes the body.
CREATE TRIGGER documents_fts_update
AFTER UPDATE OF title, author, body, source_filename ON documents
BEGIN
  DELETE FROM documents_fts WHERE document_id = old.id;
  INSERT INTO documents_fts(document_id, title, author, body, file_name)
  VALUES (new.id, new.title, COALESCE(new.author, ''), new.body, COALESCE(new.source_filename, ''));
END;

INSERT INTO documents_fts(document_id, title, author, body, file_name)
SELECT d.id, d.title, COALESCE(d.author, ''), d.body, COALESCE(d.source_filename, '')
FROM documents AS d;
