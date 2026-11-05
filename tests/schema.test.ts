import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SCHEMA_SQL } from '../server/utils/schema.ts'

test('D1 migration matches the runtime schema', () => {
  const migration = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
  assert.equal(migration.trim(), SCHEMA_SQL.trim())
})
