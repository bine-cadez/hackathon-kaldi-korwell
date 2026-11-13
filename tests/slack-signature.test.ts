import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import test from 'node:test'
import events from '../server/api/slack/events.post.ts'

const secret = '8f742231b10e8888abcd99yyyzzz85a5'

function sign (body: string, at: string) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${at}:${body}`).digest('hex')
}

test('url_verification returns the challenge and a bad signature does not', async () => {
  const body = JSON.stringify({ type: 'url_verification', challenge: 'challenge-token' })
  const now = Math.floor(Date.now() / 1000).toString()
  const app = createApp()
  app.use(defineEventHandler((event) => {
    event.context.cloudflare = { env: { SLACK_SIGNING_SECRET: secret, SLACK_CHANNEL_IDS: '' } }
  }))
  app.use(events)
  const handler = toWebHandler(app)
  const ok = await handler(new Request('https://library.test/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': now,
      'x-slack-signature': sign(body, now)
    },
    body
  }))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { challenge: 'challenge-token' })

  const bad = await handler(new Request('https://library.test/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': now,
      'x-slack-signature': 'v0=' + 'cd'.repeat(32)
    },
    body
  }))
  assert.equal(bad.status, 401)
  assert.deepEqual(await bad.json(), { ok: false })

  const staleAt = String(Number(now) - 301)
  const stale = await handler(new Request('https://library.test/api/slack/events', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': staleAt,
      'x-slack-signature': sign(body, staleAt)
    },
    body
  }))
  assert.equal(stale.status, 401)
  assert.deepEqual(await stale.json(), { ok: false })
})
