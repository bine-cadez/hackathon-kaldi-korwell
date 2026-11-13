import assert from 'node:assert/strict'
import test from 'node:test'
import { backfillSlackChannels } from '../server/utils/slack-backfill.ts'
import type { SlackHistoryPage, SlackWebClient } from '../server/utils/slack-api.ts'
import { searchSlackMessages } from '../server/utils/slack-search.ts'
import { fakeSlackClient, openSlackDb } from './slack-db.ts'

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
