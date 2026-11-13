import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SCHEMA_SQL } from '../server/utils/schema.ts'

test('D1 migration matches the runtime schema', () => {
  const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
  assert.equal(migration.trim(), SCHEMA_SQL.trim())
})

test('document search migration is additive and folds Slovenian diacritics', () => {
  const migration = readFileSync(new URL('../migrations/0002_document_search.sql', import.meta.url), 'utf8')
  assert.match(migration, /ALTER TABLE documents ADD COLUMN author TEXT/)
  assert.match(migration, /tokenize = 'unicode61 remove_diacritics 2'/)
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS documents_fts_insert/)
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS documents_fts_delete/)
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS documents_fts_update/)
  assert.match(migration, /INSERT INTO documents_fts/)
  assert.match(migration, /NOT EXISTS/)
  assert.doesNotMatch(migration, /DROP TABLE/i)
  assert.equal(SCHEMA_SQL.includes('documents_fts'), false)
  assert.equal(SCHEMA_SQL.includes('author'), false)
})
