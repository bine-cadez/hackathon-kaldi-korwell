import assert from 'node:assert/strict'
import test from 'node:test'
import { ingestSlackCallback } from '../server/utils/slack-ingest.ts'
import { searchSlackMessages } from '../server/utils/slack-search.ts'
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

test('search ignores Slovenian word endings and falls back to any word', async () => {
  const { db } = await seed()
  await ingestSlackCallback({ db, client: fakeSlackClient(), teamId: 'T1', now: '2024-07-01T12:00:00.000Z' }, {
    type: 'event_callback',
    team_id: 'T1',
    event: {
      type: 'message',
      channel,
      user: 'UANA',
      text: 'Budget za nakup periferne tehnične opreme: 200 EUR na osebo',
      ts: '1719835200.000100'
    }
  })
  const userIds = async (query: string) => {
    const found = await searchSlackMessages(db, { query })
    assert.equal(found.configured, true)
    return found.configured ? found.matches.map(hit => hit.userId) : []
  }
  // "oprema" must find "opreme"; "budget equipment" must not lose it to the missing word.
  assert.deepEqual(await userIds('oprema'), ['UANA'])
  assert.deepEqual(await userIds('proračun budget oprema'), ['UANA'])
  assert.deepEqual(await userIds('budget equipment'), ['UANA'])
  assert.deepEqual(await userIds('equipment'), [])
})
