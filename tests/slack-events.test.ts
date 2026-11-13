import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import test from 'node:test'
import events from '../server/api/slack/events.post.ts'
import { ingestSlackCallback } from '../server/utils/slack-ingest.ts'
import { storeEditedMessage, storeNewMessage, type SlackMessageDraft } from '../server/utils/slack-store.ts'
import { searchSlackMessages } from '../server/utils/slack-search.ts'
import { fakeSlackClient, openSlackDb } from './slack-db.ts'

const secret = 'test-signing-secret'
const channel = 'C_ALLOW'
const now = '2024-05-01T12:00:00.000Z'

function sign (body: string, timestamp: string) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
}

function envelope (event: Record<string, unknown>, eventId = 'Ev1') {
  return { type: 'event_callback', team_id: 'T1', event_id: eventId, event }
}

async function postSigned (body: unknown, options?: { retry?: string, channelIds?: string, applySchema?: boolean, db?: ReturnType<typeof openSlackDb>['db'] }) {
  const db = options?.db ?? openSlackDb(options?.applySchema !== false).db
  const raw = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const pending: Promise<unknown>[] = []
  const app = createApp()
  app.use(defineEventHandler((event) => {
    event.context.cloudflare = {
      env: {
        DB: db,
        SLACK_SIGNING_SECRET: secret,
        SLACK_CHANNEL_IDS: options?.channelIds ?? channel,
        SLACK_BOT_TOKEN: ''
      },
      context: {
        waitUntil (promise: Promise<unknown>) { pending.push(promise) }
      }
    }
  }))
  app.use(events)
  const response = await toWebHandler(app)(new Request('https://library.test/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': timestamp,
      'x-slack-signature': sign(raw, timestamp),
      ...(options?.retry ? { 'x-slack-retry-num': options.retry } : {})
    },
    body: raw
  }))
  await Promise.all(pending)
  return { response, db, pending }
}

test('insert, edit, delete, thread, reaction, and file events are idempotent', async () => {
  const { sqlite, db } = openSlackDb()
  const client = fakeSlackClient()
  const deps = { db, client, teamId: 'T1', now, preferPermalinkApi: true }
  const base = {
    type: 'message',
    channel,
    user: 'UMAJA',
    text: 'Prvi osnutek za <https://kaldi.si/recept|recept> <@UANA>',
    ts: '1714550000.000100'
  }
  assert.equal((await ingestSlackCallback(deps, envelope(base))).action, 'inserted')
  assert.equal((await ingestSlackCallback(deps, envelope(base, 'Ev-retry'))).action, 'unchanged')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 1)

  const edited = await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'message_changed',
    channel,
    ts: '1714550900.000100',
    message: {
      type: 'message',
      user: 'UMAJA',
      text: 'Študentski priročnik za čokolada <https://kaldi.si/recept|recept> <@UANA>',
      ts: '1714550000.000100',
      edited: { user: 'UMAJA', ts: '1714550900.000100' }
    },
    previous_message: { text: 'Prvi osnutek za <https://kaldi.si/recept|recept> <@UANA>', ts: '1714550000.000100' }
  }))
  assert.equal(edited.action, 'edited')
  assert.equal((await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'message_changed',
    channel,
    message: {
      user: 'UMAJA',
      text: 'Študentski priročnik za čokolada <https://kaldi.si/recept|recept> <@UANA>',
      ts: '1714550000.000100',
      edited: { user: 'UMAJA', ts: '1714550900.000100' }
    },
    previous_message: { text: 'Prvi osnutek za <https://kaldi.si/recept|recept> <@UANA>' }
  }))).action, 'unchanged')

  const row = sqlite.prepare('SELECT text, edited_at, edit_history, mentions, links, permalink, channel_name, user_real_name, is_bot FROM slack_messages').get() as {
    text: string
    edited_at: string
    edit_history: string
    mentions: string
    links: string
    permalink: string
    channel_name: string
    user_real_name: string
    is_bot: number
  }
  assert.equal(row.text, 'Študentski priročnik za čokolada <https://kaldi.si/recept|recept> <@UANA>')
  assert.equal(row.edited_at, '1714550900.000100')
  assert.match(row.edit_history, /Prvi osnutek/)
  assert.match(row.mentions, /UANA/)
  assert.match(row.links, /kaldi\.si/)
  assert.match(row.permalink, /kaldi\.slack\.com/)
  assert.equal(row.channel_name, 'splošno')
  assert.equal(row.user_real_name, 'Maja Župan')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 1)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages_fts WHERE slack_messages_fts MATCH ?').get('osnutek')?.n, 0)

  const reply = await ingestSlackCallback(deps, envelope({
    type: 'message',
    channel,
    user: 'UANA',
    text: 'Štrudelj je pečen',
    ts: '1714551000.000200',
    thread_ts: '1714550000.000100'
  }))
  assert.equal(reply.action, 'inserted')

  await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'bot_message',
    channel,
    bot_id: 'B1',
    username: 'pečka',
    text: 'bot peče',
    ts: '1714551100.000300'
  }))
  const bot = sqlite.prepare('SELECT is_bot, bot_id, user_display_name FROM slack_messages WHERE ts = ?').get('1714551100.000300') as {
    is_bot: number
    bot_id: string
    user_display_name: string
  }
  assert.equal(bot.is_bot, 1)
  assert.equal(bot.bot_id, 'B1')
  assert.equal(bot.user_display_name, 'pečka')

  await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'file_share',
    channel,
    user: 'UMAJA',
    text: 'datoteka',
    ts: '1714551200.000400',
    files: [{ id: 'F1', name: 'recept.pdf', mimetype: 'application/pdf', size: 12, url_private: 'https://files.slack.com/secret' }]
  }))
  const files = sqlite.prepare('SELECT files FROM slack_messages WHERE ts = ?').get('1714551200.000400') as { files: string }
  assert.match(files.files, /recept\.pdf/)
  assert.doesNotMatch(files.files, /url_private/)
  assert.equal(JSON.parse(files.files)[0].size, 12)

  await ingestSlackCallback(deps, envelope({
    type: 'reaction_added',
    user: 'UANA',
    reaction: 'white_check_mark',
    item: { type: 'message', channel, ts: '1714550000.000100' },
    event_ts: '1714551300.000100'
  }))
  await ingestSlackCallback(deps, envelope({
    type: 'reaction_added',
    user: 'UANA',
    reaction: 'white_check_mark',
    item: { type: 'message', channel, ts: '1714550000.000100' },
    event_ts: '1714551300.000100'
  }))
  await ingestSlackCallback(deps, envelope({
    type: 'reaction_added',
    user: 'UMAJA',
    reaction: 'white_check_mark',
    item: { type: 'message', channel, ts: '1714550000.000100' },
    event_ts: '1714551400.000100'
  }))
  await ingestSlackCallback(deps, envelope({
    type: 'reaction_removed',
    user: 'UANA',
    reaction: 'white_check_mark',
    item: { type: 'message', channel, ts: '1714550000.000100' },
    event_ts: '1714551500.000100'
  }))
  await ingestSlackCallback(deps, envelope({
    type: 'reaction_added',
    user: 'UANA',
    reaction: 'white_check_mark',
    item: { type: 'message', channel, ts: '1714550000.000100' },
    event_ts: '1714551300.000100'
  }))
  const active = sqlite.prepare(
    'SELECT user_id FROM slack_reactions WHERE removed = 0 AND ts = ? ORDER BY user_id'
  ).all('1714550000.000100') as Array<{ user_id: string }>
  assert.deepEqual(active.map(item => item.user_id), ['UMAJA'])

  await ingestSlackCallback(deps, envelope({
    type: 'channel_rename',
    channel: { id: channel, name: 'arhiv' }
  }))
  assert.equal(sqlite.prepare('SELECT channel_name FROM slack_messages WHERE ts = ?').get('1714550000.000100')?.channel_name, 'arhiv')

  const removed = await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'message_deleted',
    channel,
    ts: '1714552000.000100',
    deleted_ts: '1714551200.000400',
    previous_message: { text: 'datoteka', user: 'UMAJA', ts: '1714551200.000400' }
  }))
  assert.equal(removed.action, 'deleted')
  assert.equal((await ingestSlackCallback(deps, envelope({
    type: 'message',
    channel,
    user: 'UMAJA',
    text: 'datoteka',
    ts: '1714551200.000400'
  }))).action, 'unchanged')
  const tombstone = sqlite.prepare('SELECT deleted, text FROM slack_messages WHERE ts = ?').get('1714551200.000400') as { deleted: number, text: string }
  assert.equal(tombstone.deleted, 1)
  assert.equal(tombstone.text, 'datoteka')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages_fts WHERE ts = ?').get('1714551200.000400')?.n, 0)

  const found = await searchSlackMessages(db, { query: 'cokolada' })
  assert.equal(found.configured, true)
  if (found.configured) {
    assert.equal(found.matches.some(hit => hit.text.includes('čokolada')), true)
    assert.equal(found.matches.some(hit => hit.text === 'datoteka'), false)
  }
  const thread = await searchSlackMessages(db, { query: 'strudelj' })
  if (thread.configured) {
    const reply = thread.matches.find(hit => hit.ts === '1714551000.000200')
    assert.equal(reply?.parent?.text.includes('čokolada'), true)
    assert.equal(reply?.userRealName, 'Ana Kovač')
    assert.equal(reply?.channelName, 'arhiv')
  }
})

test('signed retries store one row and other channels are ignored', async () => {
  const body = envelope({
    type: 'message',
    channel,
    user: 'UMAJA',
    text: 'ena sama',
    ts: '1714553000.000100'
  })
  const first = await postSigned(body)
  assert.equal(first.response.status, 200)
  assert.equal(first.pending.length, 1)
  const second = await postSigned(body, { retry: '2', db: first.db })
  assert.equal(second.response.status, 200)
  const ignored = await postSigned(envelope({
    type: 'message',
    channel: 'C_OTHER',
    user: 'UMAJA',
    text: 'ne shrani',
    ts: '1714553000.000100'
  }), { db: first.db })
  assert.equal(ignored.response.status, 200)
  assert.deepEqual(await ignored.response.json(), { ok: true, ignored: true })
  assert.equal(ignored.pending.length, 0)
  const count = await first.db.prepare('SELECT count(*) AS n FROM slack_messages').first<{ n: number }>()
  assert.equal(count?.n, 1)
})

test('concurrent duplicate saves do not raise a unique constraint error', async () => {
  const { sqlite, db } = openSlackDb()
  const draft: SlackMessageDraft = {
    channelId: channel,
    ts: '1714554000.000100',
    teamId: 'T1',
    channelName: 'splošno',
    userId: 'UMAJA',
    userDisplayName: 'maja',
    userRealName: 'Maja Župan',
    threadTs: null,
    replyCount: null,
    text: 'isti dogodek',
    editedAt: null,
    editHistory: [],
    deleted: false,
    deletedAt: null,
    subtype: null,
    isBot: false,
    botId: null,
    mentions: [],
    links: [],
    files: [],
    permalink: 'https://slack.com/archives/C_ALLOW/p1714554000000100',
    rawEvent: { ts: '1714554000.000100' },
    createdAt: now,
    updatedAt: now
  }
  const saved = await Promise.all([
    storeNewMessage(db, draft),
    storeNewMessage(db, draft)
  ])
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages').get()?.n, 1)
  assert.ok(saved.includes('inserted'))
  assert.equal(saved.every(action => action === 'inserted' || action === 'unchanged'), true)

  const edited = { ...draft, text: 'isti dogodek, popravljen', editedAt: '1714554100.000100', ts: '1714554100.000200' }
  const edits = await Promise.all([
    storeEditedMessage(db, edited, 'staro', 'UMAJA'),
    storeEditedMessage(db, edited, 'staro', 'UMAJA')
  ])
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM slack_messages WHERE ts = ?').get(edited.ts)?.n, 1)
  assert.ok(edits.every(action => action === 'inserted' || action === 'edited' || action === 'unchanged'))
})

test('events before the migration return not configured', async () => {
  const { response } = await postSigned(envelope({
    type: 'message',
    channel,
    user: 'U1',
    text: 'prezgodaj',
    ts: '1714553000.000100'
  }), { applySchema: false })
  assert.equal(response.status, 503)
  const payload = await response.json() as { data?: { message?: string } }
  assert.match(payload.data?.message || '', /0003_slack_archive/)
})
