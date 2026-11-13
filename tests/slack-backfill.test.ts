import assert from 'node:assert/strict'
import test from 'node:test'
import { createSlackWebClient, SlackApiError } from '../server/utils/slack-api.ts'
import { backfillSlackChannels } from '../server/utils/slack-backfill.ts'
import type { SlackHistoryPage, SlackWebClient } from '../server/utils/slack-api.ts'
import { searchSlackMessages } from '../server/utils/slack-search.ts'
import { fakeSlackClient, openSlackDb } from './slack-db.ts'

test('Slack client retries a 429 using Retry-After', async () => {
  let calls = 0
  const client = createSlackWebClient('xoxb-test', {
    sleep: async () => {},
    fetch: async () => {
      calls += 1
      if (calls === 1) return new Response('{}', { status: 429, headers: { 'retry-after': '1' } })
      return Response.json({
        ok: true,
        user: { real_name: 'Maja Župan', profile: { display_name: 'maja' } }
      })
    }
  })
  const info = await client.usersInfo('UMAJA')
  assert.equal(calls, 2)
  assert.equal(info?.realName, 'Maja Župan')
  assert.equal(info?.displayName, 'maja')
})

test('backfill pages history and replies once per message', async () => {
  const { sqlite, db } = openSlackDb()
  const history: SlackHistoryPage[] = [
    {
      messages: [
        { ts: '1714550400.000100', user: 'UMAJA', text: 'Naročilo čokolade', reply_count: 1 },
        { ts: '1714550500.000100', user: 'UANA', text: 'opomba', reply_count: 0 }
      ],
      nextCursor: 'page-2'
    },
    {
      messages: [
        { ts: '1714550600.000100', user: 'UMAJA', text: 'še ena', reply_count: 0 }
      ],
      nextCursor: null
    }
  ]
  let historyCalls = 0
  const client: SlackWebClient = fakeSlackClient({
    conversationsHistory: async (_channel, cursor) => {
      historyCalls += 1
      if (!cursor) return history[0]!
      assert.equal(cursor, 'page-2')
      return history[1]!
    },
    conversationsReplies: async () => ({
      messages: [
        { ts: '1714550400.000100', user: 'UMAJA', text: 'Naročilo čokolade', reply_count: 1 },
        { ts: '1714550400.000200', user: 'UANA', text: 'Štrudelj', thread_ts: '1714550400.000100' }
      ],
      nextCursor: null
    })
  })
  const report = await backfillSlackChannels({
    db,
    client,
    channelIds: ['C_ALLOW'],
    deadlineMs: 30_000
  })
  assert.equal(report.partial, false)
  assert.equal(report.channels[0]?.messages, 3)
  assert.equal(report.channels[0]?.replies, 1)
  assert.equal(historyCalls, 2)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 4)

  const again = await backfillSlackChannels({ db, client, channelIds: ['C_ALLOW'], deadlineMs: 30_000 })
  assert.equal(again.channels[0]?.messages, 3)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 4)

  const found = await searchSlackMessages(db, { query: 'strudelj' })
  if (!found.configured) throw new Error('expected archive')
  assert.equal(found.matches[0]?.parent?.text, 'Naročilo čokolade')
  assert.match(found.matches[0]?.permalink || '', /slack\.com\/archives/)
})

test('backfill stops at the deadline and records a channel error', async () => {
  const { db } = openSlackDb()
  let ticks = 0
  const partial = await backfillSlackChannels({
    db,
    client: fakeSlackClient({
      conversationsHistory: async () => ({
        messages: [{ ts: '1714550400.000100', user: 'UMAJA', text: 'ena', reply_count: 0 }],
        nextCursor: 'more'
      })
    }),
    channelIds: ['C_ALLOW'],
    deadlineMs: 15,
    now: () => {
      ticks += 10
      return ticks
    }
  })
  assert.equal(partial.partial, true)
  assert.equal(partial.resume?.historyCursor, 'more')
  assert.equal(partial.channels[0]?.messages, 1)

  const failed = await backfillSlackChannels({
    db,
    client: fakeSlackClient({
      conversationsHistory: async () => { throw new SlackApiError('not_in_channel') }
    }),
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 30_000
  })
  assert.equal(failed.partial, false)
  assert.equal(failed.channels[0]?.error, 'not_in_channel')
  assert.equal(failed.channels[1]?.error, 'not_in_channel')
})
