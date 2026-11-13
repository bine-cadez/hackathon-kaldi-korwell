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

test('a query budget stops with a thread resume and the next call finishes', async () => {
  const { sqlite, db } = openSlackDb()
  const client = fakeSlackClient({
    conversationsHistory: async (channelId, cursor) => {
      if (channelId !== 'C_ALLOW') return { messages: [], nextCursor: null }
      if (!cursor) {
        return {
          messages: [
            { ts: '1.000100', user: 'UMAJA', text: 'prva', reply_count: 1 },
            { ts: '1.000200', user: 'UANA', text: 'druga', reply_count: 0 }
          ],
          nextCursor: 'page-2'
        }
      }
      return {
        messages: [{ ts: '1.000300', user: 'UMAJA', text: 'tretja', reply_count: 0 }],
        nextCursor: null
      }
    },
    conversationsReplies: async (_channel, _ts, cursor) => {
      if (!cursor) {
        return {
          messages: [
            { ts: '1.000100', user: 'UMAJA', text: 'prva', reply_count: 1 },
            { ts: '1.000150', user: 'UANA', text: 'odgovor ena', thread_ts: '1.000100' }
          ],
          nextCursor: 'replies-2'
        }
      }
      assert.equal(cursor, 'replies-2')
      return {
        messages: [{ ts: '1.000160', user: 'UANA', text: 'odgovor dve', thread_ts: '1.000100' }],
        nextCursor: null
      }
    }
  })
  const first = await backfillSlackChannels({
    db,
    client,
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 30_000,
    queryBudget: 2
  })
  assert.equal(first.partial, true)
  assert.equal(first.resume?.channelId, 'C_ALLOW')
  assert.equal(first.resume?.threadTs, '1.000100')
  assert.equal(first.resume?.repliesCursor, 'replies-2')
  assert.equal(first.channels.some(channel => channel.channelId === 'C_OTHER'), false)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages WHERE ts = ?').get('1.000160')?.n, 0)

  const second = await backfillSlackChannels({
    db,
    client,
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 30_000,
    resume: first.resume
  })
  assert.equal(second.partial, false)
  const rows = sqlite.prepare('SELECT channel_id, ts FROM slack_messages ORDER BY ts').all() as Array<{ channel_id: string, ts: string }>
  assert.deepEqual(rows.map(row => row.ts), ['1.000100', '1.000150', '1.000160', '1.000200', '1.000300'])
  assert.ok(rows.every(row => row.channel_id === 'C_ALLOW'))
})

test('one channel error does not drop the other channels', async () => {
  const { sqlite, db } = openSlackDb()
  const report = await backfillSlackChannels({
    db,
    client: fakeSlackClient({
      conversationsHistory: async (channelId) => {
        if (channelId === 'C_ALLOW') throw new SlackApiError('not_in_channel')
        return {
          messages: [{ ts: '2.000100', user: 'UMAJA', text: 'živijo', reply_count: 0 }],
          nextCursor: null
        }
      }
    }),
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 30_000
  })
  assert.equal(report.partial, false)
  assert.equal(report.resume, null)
  assert.equal(report.channels[0]?.error, 'not_in_channel')
  assert.equal(report.channels[1]?.messages, 1)
  assert.equal(report.channels[1]?.error, undefined)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 1)
})

test('a Retry-After that would pass the deadline resumes instead of sleeping', async () => {
  const { db } = openSlackDb()
  let slept = false
  const client = createSlackWebClient('xoxb-test', {
    sleep: async () => { slept = true },
    allowWait: () => false,
    fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '30' } })
  })
  const report = await backfillSlackChannels({
    db,
    client,
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 5_000
  })
  assert.equal(slept, false)
  assert.equal(report.partial, true)
  assert.equal(report.resume?.channelId, 'C_ALLOW')
  assert.equal(report.resume?.historyCursor, '')
  assert.equal(report.channels.length, 1)
  assert.equal(report.channels[0]?.error, undefined)
})

test('a D1 query-limit error stops cleanly instead of failing the rest of the run', async () => {
  const { db } = openSlackDb()
  const original = db.batch.bind(db)
  let batches = 0
  db.batch = (statements) => {
    batches += 1
    if (batches > 1) throw new Error('D1_ERROR: Too many requests. Exceeded the maximum number of queries.')
    return original(statements)
  }
  const report = await backfillSlackChannels({
    db,
    client: fakeSlackClient({
      conversationsHistory: async (_channel, cursor) => ({
        messages: [{ ts: cursor ? '3.000200' : '3.000100', user: 'UMAJA', text: 'ena', reply_count: 0 }],
        nextCursor: cursor ? null : 'page-2'
      })
    }),
    channelIds: ['C_ALLOW', 'C_OTHER'],
    deadlineMs: 30_000
  })
  assert.equal(report.partial, true)
  assert.equal(report.resume?.historyCursor, 'page-2')
  assert.equal(report.channels.some(channel => channel.error), false)
  assert.equal(report.channels.some(channel => channel.channelId === 'C_OTHER'), false)
})
