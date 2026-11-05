import assert from 'node:assert/strict'
import test from 'node:test'
import { cosineSimilarity, rankByCosine } from '../server/utils/vectors.ts'

test('cosine similarity is 1 for the same direction', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [2, 0, 0]) - 1) < 1e-9)
})

test('cosine similarity is 0 for orthogonal vectors', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
})

test('rankByCosine returns the nearest vector first', () => {
  const ranked = rankByCosine([
    { id: 'far', embedding: [0, 1, 0] },
    { id: 'near', embedding: [1, 0.1, 0] }
  ], [1, 0, 0], 1)
  assert.equal(ranked.length, 1)
  assert.equal(ranked[0]?.id, 'near')
  assert.ok((ranked[0]?.score ?? 0) > 0.9)
})
