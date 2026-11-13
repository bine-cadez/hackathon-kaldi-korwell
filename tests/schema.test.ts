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

test('the used-code migration creates the table the token endpoint writes to', async () => {
  const { sqliteD1 } = await import('./helpers/d1-sqlite.ts')
  const { d1UsedCodeStore } = await import('../server/utils/mcp-code-store.ts')
  const db = sqliteD1()
  db.raw.exec(readFileSync(new URL('../migrations/0004_mcp_used_codes.sql', import.meta.url), 'utf8'))
  const store = d1UsedCodeStore(db)!
  const exp = Math.floor(Date.now() / 1000) + 120
  assert.equal(await store.consume('jti-1', exp), true)
  assert.equal(await store.consume('jti-1', exp), false)
  assert.equal(await store.consume('jti-2', exp), true)
})

function countingDb (migrated: { author: boolean, fts: boolean, source?: boolean, titleSort?: boolean }) {
  const calls = { exec: 0, prepare: 0 }
  const db = {
    exec: async () => { calls.exec++ },
    prepare: (sql: string) => {
      calls.prepare++
      return {
        all: async () => {
          if (sql.startsWith('PRAGMA table_info(chunks)')) return { results: [{ name: 'embedding' }] }
          if (sql.startsWith('PRAGMA table_info(documents)')) {
            return {
              results: [
                ...(migrated.author ? [{ name: 'author' }] : []),
                ...(migrated.source ? [{ name: 'source_key' }] : []),
                ...(migrated.titleSort ? [{ name: 'title_sort' }] : [])
              ]
            }
          }
          return { results: migrated.fts ? [{ name: 'documents_fts' }] : [] }
        }
      }
    }
  }
  return { db: db as never, calls, migrated }
}

test('ensureSchema runs once per database binding', async () => {
  const { ensureSchema } = await import('../server/utils/schema.ts')
  const { db, calls } = countingDb({ author: true, fts: true, source: true, titleSort: true })
  await Promise.all([ensureSchema(db), ensureSchema(db)])
  await ensureSchema(db)
  assert.equal(calls.exec, 3)
  assert.equal(calls.prepare, 1)
})

test('ensureSchema retries after a failure', async () => {
  const { ensureSchema } = await import('../server/utils/schema.ts')
  let fail = true
  const db = {
    exec: async () => { if (fail) throw new Error('D1 unavailable') },
    prepare: () => ({ all: async () => ({ results: [{ name: 'embedding' }] }) })
  }
  await assert.rejects(ensureSchema(db), /D1 unavailable/)
  fail = false
  await ensureSchema(db)
})

test('search capabilities are cached only once fully migrated', async () => {
  const { readSearchCapabilities } = await import('../server/utils/capabilities.ts')
  const { db, calls, migrated } = countingDb({ author: false, fts: false, source: false, titleSort: false })
  const none = { author: false, fts: false, source: false, titleSort: false }

  assert.deepEqual(await readSearchCapabilities(db), none)
  assert.deepEqual(await readSearchCapabilities(db), none)
  assert.equal(calls.prepare, 4)

  // 0002 alone is not fully migrated: 0005 and 0007 can still arrive without a redeploy.
  migrated.author = true
  migrated.fts = true
  assert.deepEqual(await readSearchCapabilities(db), { ...none, author: true, fts: true })
  assert.equal(calls.prepare, 6)

  migrated.source = true
  assert.deepEqual(await readSearchCapabilities(db), { author: true, fts: true, source: true, titleSort: false })
  assert.equal(calls.prepare, 8)

  migrated.titleSort = true
  assert.deepEqual(await readSearchCapabilities(db), { author: true, fts: true, source: true, titleSort: true })
  assert.deepEqual(await readSearchCapabilities(db), { author: true, fts: true, source: true, titleSort: true })
  assert.equal(calls.prepare, 10)
})
