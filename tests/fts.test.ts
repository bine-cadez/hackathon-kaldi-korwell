import assert from 'node:assert/strict'
import test from 'node:test'
import { buildFtsMatch } from '../server/utils/fts.ts'

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
