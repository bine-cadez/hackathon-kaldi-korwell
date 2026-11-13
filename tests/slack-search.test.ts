import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { SCHEMA_SQL } from '../server/utils/schema.ts'
import { ingestSlackCallback } from '../server/utils/slack-ingest.ts'
import { searchSlackMessages } from '../server/utils/slack-search.ts'
import { buildSlackFtsMatch, parseSlackDateRange } from '../server/utils/slack-text.ts'
import { fakeSlackClient, openSlackDb } from './slack-db.ts'

const channel = 'C_ALLOW'

async function seed () {
  const opened = openSlackDb()
  const deps = { db: opened.db, client: fakeSlackClient(), teamId: 'T1', now: '2024-05-01T12:00:00.000Z' }
  await ingestSlackCallback(deps, {
    type: 'event_callback',
    team_id: 'T1',
    event: {
      type: 'message',
      channel,
      user: 'UMAJA',
      text: 'Študentski priročnik omenja čokolada',
      ts: '1714550400.000100'
    }
  })
  await ingestSlackCallback(deps, {
    type: 'event_callback',
    event: {
      type: 'message',
      channel,
      user: 'UANA',
      text: 'Sestanek je v četrtek',
      ts: '1717228800.000100'
    }
  })
  return opened
}

test('slack migration folds diacritics and stays out of the base schema', () => {
  const migration = readFileSync(new URL('../migrations/0003_slack_archive.sql', import.meta.url), 'utf8')
  assert.match(migration, /tokenize = 'unicode61 remove_diacritics 2'/)
  assert.match(migration, /PRIMARY KEY \(channel_id, ts\)/)
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS slack_messages_fts_insert/)
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS slack_messages_fts_update/)
  assert.doesNotMatch(migration, /WHEN NEW\.deleted = 1/)
  assert.equal(SCHEMA_SQL.includes('slack_messages'), false)
  assert.equal(buildSlackFtsMatch('čokolada AND "drop"'), '(("čokolada" "AND" "drop") OR ("čokolada AND drop"))')
  assert.equal(buildSlackFtsMatch('čokolada'), '"čokolada"')
  assert.equal(parseSlackDateRange('2024-05-01', '2024-05-01').toExclusive, Date.UTC(2024, 4, 2) / 1000)
})

test('full-text search matches Slovenian diacritics and filters channel, user, and date', async () => {
  const { db } = await seed()
  const folded = await searchSlackMessages(db, { query: 'studentski cokolada' })
  assert.equal(folded.configured, true)
  if (!folded.configured) return
  assert.equal(folded.matches.length, 1)
  assert.equal(folded.matches[0]?.userRealName, 'Maja Župan')
  assert.equal(folded.matches[0]?.channelName, 'splošno')
  assert.equal(folded.matches[0]?.sentAt, '2024-05-01T08:00:00.000Z')

  const accented = await searchSlackMessages(db, { query: 'Župan' })
  if (!accented.configured) return
  assert.equal(accented.matches[0]?.userId, 'UMAJA')

  const channelName = await searchSlackMessages(db, { query: 'splosno' })
  if (!channelName.configured) return
  assert.ok(channelName.matches.every(hit => hit.channelId === channel))

  const may = await searchSlackMessages(db, { query: 'cokolada', from: '2024-05-01', to: '2024-05-01' })
  if (!may.configured) return
  assert.deepEqual(may.matches.map(hit => hit.userId), ['UMAJA'])

  const june = await searchSlackMessages(db, { query: 'cetrtek', from: '2024-06-01', to: '2024-06-01' })
  if (!june.configured) return
  assert.deepEqual(june.matches.map(hit => hit.userId), ['UANA'])

  const person = await searchSlackMessages(db, { query: 'cetrtek', user: 'Kovač' })
  if (!person.configured) return
  assert.deepEqual(person.matches.map(hit => hit.userId), ['UANA'])

  const byId = await searchSlackMessages(db, { channel: 'C_ALLOW', user: 'UMAJA', from: '2024-05-01', to: '2024-05-31' })
  if (!byId.configured) return
  assert.deepEqual(byId.matches.map(hit => hit.userId), ['UMAJA'])
})

test('search before the slack migration is not configured', async () => {
  const { db } = openSlackDb(false)
  const result = await searchSlackMessages(db, { query: 'čokolada' })
  assert.deepEqual(result, { configured: false })
})

test('impossible dates are rejected', async () => {
  const { db } = openSlackDb()
  await assert.rejects(
    () => searchSlackMessages(db, { query: 'cokolada', from: '2023-02-29' }),
    (error: unknown) => (error as { statusCode?: number }).statusCode === 400
  )
})
