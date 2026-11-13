import assert from 'node:assert/strict'
import test from 'node:test'
import { EMBEDDING_DIMENSIONS, parseEmbeddings } from '../server/utils/embeddings.ts'

test('parseEmbeddings restores provider index order', () => {
  const first = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / 10)
  const second = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / 20)
  const parsed = parseEmbeddings({
    data: [
      { index: 1, embedding: second },
      { index: 0, embedding: first }
    ]
  }, 2, EMBEDDING_DIMENSIONS)
  assert.deepEqual(parsed[0], first)
  assert.deepEqual(parsed[1], second)
})
