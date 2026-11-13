import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkText, TARGET_CHARS } from '../server/utils/chunk.ts'

test('a long unbroken string still chunks', () => {
  const chunks = chunkText('a'.repeat(5000))
  assert.ok(chunks.length >= 4)
  assert.ok(chunks.every(chunk => chunk.length <= TARGET_CHARS))
})
