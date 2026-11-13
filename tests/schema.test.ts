import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SCHEMA_SQL } from '../server/utils/schema.ts'

test('D1 migration matches the runtime schema', () => {
  const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
  assert.equal(migration.trim(), SCHEMA_SQL.trim())
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
