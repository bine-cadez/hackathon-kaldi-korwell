import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { sqliteD1 } from './helpers/d1-sqlite.ts'
import { SCHEMA_SQL } from '../server/utils/schema.ts'
import {
  contentHash,
  findDuplicate
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
