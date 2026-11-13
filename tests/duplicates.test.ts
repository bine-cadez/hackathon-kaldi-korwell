import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sqliteD1 } from './helpers/d1-sqlite.ts'
import { SCHEMA_SQL } from '../server/utils/schema.ts'
import {
  backfillContentHashes,
  contentHash,
  duplicateCheckEnabled,
  duplicateError,
  findDuplicate,
  hasContentHashColumn
} from '../server/utils/duplicates.ts'

function migratedDb ({ withHash = true } = {}) {
  const db = sqliteD1()
  db.raw.exec(SCHEMA_SQL)
  if (withHash) db.raw.exec(readFileSync(new URL('../migrations/0006_document_content_hash.sql', import.meta.url), 'utf8'))
  return db
}

function insert (db: ReturnType<typeof sqliteD1>, id: string, body: string, createdAt: string, hash: string | null = null) {
  const columns = hash === null ? '' : ', content_hash'
  const values = hash === null ? '' : ', ?'
  db.raw.prepare(`INSERT INTO documents (id, title, body, r2_key, created_at${columns}) VALUES (?, ?, ?, NULL, ?${values})`)
    .run(...[id, `Title ${id}`, body, createdAt, ...(hash === null ? [] : [hash])])
}

test('duplicateCheckEnabled is on by default and off only for off-like values', () => {
  assert.equal(duplicateCheckEnabled(), true)
  assert.equal(duplicateCheckEnabled(undefined, ''), true)
  assert.equal(duplicateCheckEnabled('on'), true)
  assert.equal(duplicateCheckEnabled('true'), true)
  for (const value of ['off', 'OFF', 'false', '0', 'no', ' disabled ']) assert.equal(duplicateCheckEnabled(value), false, value)
  // The Worker binding wins over process.env; blank sources are skipped.
  assert.equal(duplicateCheckEnabled('on', 'off'), true)
  assert.equal(duplicateCheckEnabled('', 'off'), false)
})

test('contentHash is a stable SHA-256 hex digest', async () => {
  assert.equal(await contentHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.notEqual(await contentHash('abc'), await contentHash('abd'))
})

test('the 0006 migration is additive and indexed', () => {
  const migration = readFileSync(new URL('../migrations/0006_document_content_hash.sql', import.meta.url), 'utf8')
  assert.match(migration, /ALTER TABLE documents ADD COLUMN content_hash TEXT/)
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_documents_content_hash/)
  const sql = migration.replace(/--.*$/gm, '')
  assert.doesNotMatch(sql, /UNIQUE|DROP/i)
})

test('hasContentHashColumn reflects whether 0006 ran', async () => {
  assert.equal(await hasContentHashColumn(migratedDb({ withHash: false }) as never), false)
  assert.equal(await hasContentHashColumn(migratedDb() as never), true)
})

test('findDuplicate returns the oldest document with the same hash', async () => {
  const db = migratedDb()
  const hash = await contentHash('same body')
  insert(db, 'newer', 'same body', '2026-11-13T10:00:00.000Z', hash)
  insert(db, 'older', 'same body', '2026-11-12T10:00:00.000Z', hash)
  insert(db, 'other', 'different', '2026-11-11T10:00:00.000Z', await contentHash('different'))
  assert.deepEqual(await findDuplicate(db as never, hash), { id: 'older', title: 'Title older', createdAt: '2026-11-12T10:00:00.000Z' })
  assert.equal(await findDuplicate(db as never, await contentHash('nothing like it')), null)
})

test('documents saved before 0006 are hashed on the next check', async () => {
  const db = migratedDb()
  insert(db, 'legacy', 'Old body\r\n', '2026-11-01T10:00:00.000Z')
  const duplicate = await findDuplicate(db as never, await contentHash('Old body'))
  assert.equal(duplicate?.id, 'legacy')
  const row = db.raw.prepare('SELECT content_hash FROM documents WHERE id = ?').get('legacy') as { content_hash: string }
  assert.equal(row.content_hash, await contentHash('Old body'))
})

test('backfill is bounded per call', async () => {
  const db = migratedDb()
  for (let i = 0; i < 5; i++) insert(db, `doc-${i}`, `body ${i}`, '2026-11-01T10:00:00.000Z')
  assert.equal(await backfillContentHashes(db as never, 2), 2)
  assert.equal(await backfillContentHashes(db as never, 2), 2)
  assert.equal(await backfillContentHashes(db as never, 2), 1)
  assert.equal(await backfillContentHashes(db as never, 2), 0)
})

test('duplicateError is a 409 that carries the existing document', () => {
  const error = duplicateError({ id: 'abc', title: 'Runbook', createdAt: '2026-11-12T10:00:00.000Z' }) as unknown as {
    statusCode: number
    data: { message: string, duplicate: { id: string } }
  }
  assert.equal(error.statusCode, 409)
  assert.equal(error.data.duplicate.id, 'abc')
  assert.match(error.data.message, /already in the archive as “Runbook”/)
})
