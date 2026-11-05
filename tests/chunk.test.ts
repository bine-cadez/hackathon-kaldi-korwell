import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkText, ChunkLimitError, MAX_CHUNKS, TARGET_CHARS } from '../server/utils/chunk.ts'

test('blank input produces no chunks', () => {
  assert.deepEqual(chunkText('  \n\n\t '), [])
})

test('short text stays one chunk', () => {
  assert.deepEqual(chunkText('Hello library'), ['Hello library'])
})

test('long prose splits into overlapping chunks under the target size', () => {
  const body = Array.from({ length: 500 }, (_, index) => `word${index}`).join(' ')
  const chunks = chunkText(body)
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every(chunk => chunk.length <= TARGET_CHARS))
  const overlap = chunks[0]!.slice(-40)
  assert.ok(chunks[1]!.includes(overlap.trim().slice(-20)))
})

test('a long unbroken string still chunks', () => {
  const chunks = chunkText('a'.repeat(5000))
  assert.ok(chunks.length >= 4)
  assert.ok(chunks.every(chunk => chunk.length <= TARGET_CHARS))
})

test('too many chunks is rejected', () => {
  const body = Array.from({ length: MAX_CHUNKS + 5 }, () => 'p'.repeat(TARGET_CHARS)).join('\n\n')
  assert.throws(() => chunkText(body), ChunkLimitError)
})
