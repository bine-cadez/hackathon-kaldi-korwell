import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import test from 'node:test'
import events from '../server/api/slack/events.post.ts'
import { verifySlackSignature } from '../server/utils/slack-signature.ts'

const secret = '8f742231b10e8888abcd99yyyzzz85a5'
const timestamp = '1531420618'
const rawBody = 'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U0CZ8T9AB&user_name=Steve&command=%2Fweather&text=94070&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZj3mLmrNNy&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c'
const validSignature = 'v0=d38fdcf62e04935bf3b5aa0be827e81935e92f1cb8bcf256046e607dfc3a9739'

function sign (body: string, at = timestamp) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${at}:${body}`).digest('hex')
}

test('a valid Slack signature matches an independent HMAC', async () => {
  assert.equal(sign(rawBody), validSignature)
  const verdict = await verifySlackSignature({
    signingSecret: secret,
    timestamp,
    signature: validSignature,
    rawBody,
    nowSeconds: Number(timestamp)
  })
  assert.deepEqual(verdict, { ok: true })
})

test('a bad signature is rejected after a constant-time compare', async () => {
  const verdict = await verifySlackSignature({
    signingSecret: secret,
    timestamp,
    signature: 'v0=' + 'ab'.repeat(32),
    rawBody,
    nowSeconds: Number(timestamp)
  })
  assert.equal(verdict.ok, false)
  if (!verdict.ok) {
    assert.equal(verdict.status, 401)
    assert.equal(verdict.reason, 'invalid_signature')
  }
})

test('a timestamp older than five minutes is rejected', async () => {
  const verdict = await verifySlackSignature({
    signingSecret: secret,
    timestamp,
    signature: validSignature,
    rawBody,
    nowSeconds: Number(timestamp) + (5 * 60) + 1
  })
  assert.equal(verdict.ok, false)
  if (!verdict.ok) assert.equal(verdict.reason, 'stale_timestamp')
})

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
  const payload = await bad.json() as { error?: string }
  assert.equal(payload.error, 'invalid_signature')

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
  assert.equal((await stale.json() as { error?: string }).error, 'stale_timestamp')
})

test('missing signing secret answers not configured', async () => {
  const previous = process.env.SLACK_SIGNING_SECRET
  delete process.env.SLACK_SIGNING_SECRET
  try {
    const app = createApp()
    app.use(defineEventHandler((event) => {
      event.context.cloudflare = { env: {} }
    }))
    app.use(events)
    const response = await toWebHandler(app)(new Request('https://library.test/api/slack/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }))
    assert.equal(response.status, 503)
    const payload = await response.json() as { data?: { message?: string }, message?: string }
    assert.match(payload.data?.message || payload.message || '', /not configured/i)
  } finally {
    if (previous === undefined) delete process.env.SLACK_SIGNING_SECRET
    else process.env.SLACK_SIGNING_SECRET = previous
  }
})
