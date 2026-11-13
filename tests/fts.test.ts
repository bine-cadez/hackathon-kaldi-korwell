import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFtsMatch, foldDiacritics, fuseRankedHits, textHasTokens } from '../server/utils/fts.ts'

test('diacritic folding maps Slovenian carons onto c s z', () => {
  assert.equal(foldDiacritics('Čokolada Študent Župan'), 'cokolada student zupan')
  assert.equal(textHasTokens('Maja Župan', ['zupan']), true)
  assert.equal(textHasTokens('Maja Župan', ['kovac']), false)
})

test('FTS match quotes tokens so operators stay words', () => {
  assert.equal(buildFtsMatch([{ text: 'Čokolada' }]), '"Čokolada"')
  assert.equal(buildFtsMatch([{ column: 'author', text: 'Župan' }]), 'author : "Župan"')
  assert.equal(
    buildFtsMatch([{ text: 'title: OR "drop"' }]),
    '(("title" "OR" "drop") OR ("title OR drop"))'
  )
  assert.equal(
    buildFtsMatch([
      { text: 'štrudelj' },
      { column: 'title', text: 'Čokolada' },
      { column: 'author', text: 'Župan' }
    ]),
    '"štrudelj" AND title : "Čokolada" AND author : "Župan"'
  )
  assert.equal(buildFtsMatch([{ text: '???' }]), null)
})

test('fusion keeps vector scores when keyword search is empty', () => {
  const vector = [{ id: 'a', score: 0.42 }, { id: 'b', score: 0.2 }]
  const combined = fuseRankedHits(vector, [], 5, item => item.id)
  assert.equal(combined.fused, false)
  assert.deepEqual(combined.hits.map(hit => hit.score), [0.42, 0.2])
  assert.equal(combined.hits[0], vector[0])
})
