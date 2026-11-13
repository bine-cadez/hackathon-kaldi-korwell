import assert from 'node:assert/strict'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, describe, test } from 'node:test'
import login from '../server/api/auth/login.post.ts'
import logout from '../server/api/auth/logout.post.ts'
import sitePassword from '../server/middleware/site-password.ts'
import {
  decideSiteAccess,
  siteSessionToken,
  SITE_AUTH_COOKIE
} from '../server/utils/site-password.ts'

const savedPassword = process.env.SITE_PASSWORD

afterEach(() => {
  if (savedPassword === undefined) delete process.env.SITE_PASSWORD
  else process.env.SITE_PASSWORD = savedPassword
})

describe('site password decision', { concurrency: false }, () => {
  test('wrong password, raw password cookie, and basic auth stay locked', async () => {
    assert.equal(await decideSiteAccess({
      sitePassword: 's3cret',
      method: 'POST',
      pathname: '/api/search',
      cookie: null,
      authorization: 'Bearer wrong',
      sitePasswordHeader: 'nope'
    }), 'unauthorized')
    assert.equal(await decideSiteAccess({
      sitePassword: 's3cret',
      method: 'POST',
      pathname: '/api/documents',
      cookie: 's3cret',
      authorization: null,
      sitePasswordHeader: null
    }), 'unauthorized')
    assert.equal(await decideSiteAccess({
      sitePassword: 's3cret',
      method: 'GET',
      pathname: '/api/documents',
      cookie: null,
      authorization: 'Basic s3cret',
      sitePasswordHeader: null
    }), 'unauthorized')
    const oldToken = await siteSessionToken('previous')
    assert.equal(await decideSiteAccess({
      sitePassword: 's3cret',
      method: 'POST',
      pathname: '/api/search',
      cookie: oldToken,
      authorization: null,
      sitePasswordHeader: null
    }), 'unauthorized')
  })
})

describe('site password HTTP gate', { concurrency: false }, () => {
  const handler = toWebHandler(createApp()
    .use(sitePassword)
    .use('/api/auth/login', login)
    .use('/api/auth/logout', logout)
    .use(defineEventHandler(() => ({ reached: true }))))

  test('direct API calls without credentials get 401 and never reach the route', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    for (const [method, path] of [
      ['POST', '/api/documents'],
      ['POST', '/api/search'],
      ['GET', '/api/documents'],
      ['GET', '/api/documents/doc_1'],
      ['DELETE', '/api/documents/doc_1'],
      ['POST', '/api/slack/search'],
      ['POST', '/api/slack/backfill']
    ] as const) {
      const response = await handler(new Request(`http://library.test${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({ title: 'x', body: 'y', query: 'q' })
      }))
      assert.equal(response.status, 401, `${method} ${path}`)
      const payload = await response.json() as { reached?: boolean, data?: { message?: string } }
      assert.equal(payload.reached, undefined)
      assert.match(payload.data?.message || '', /password/i)
    }
  })

  test('GET /api/health stays public while the page shows the unlock form', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    const health = await handler(new Request('http://library.test/api/health'))
    assert.equal(health.status, 200)
    assert.equal((await health.json() as { reached?: boolean }).reached, true)

    const page = await handler(new Request('http://library.test/'))
    assert.equal(page.status, 401)
    const html = await page.text()
    assert.match(html, /type="password"/)
    assert.match(html, /action="\/api\/auth\/login"/)
    assert.doesNotMatch(html, /reached/)
  })

  test('X-Site-Password and Authorization bearer unlock API routes', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    const header = await handler(new Request('http://library.test/api/search', {
      method: 'POST',
      headers: { 'x-site-password': 's3cret', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'q' })
    }))
    assert.equal(header.status, 200)
    assert.equal((await header.json() as { reached?: boolean }).reached, true)

    const bearer = await handler(new Request('http://library.test/api/documents', {
      method: 'POST',
      headers: { authorization: 'Bearer s3cret', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 't', body: 'b' })
    }))
    assert.equal(bearer.status, 200)
    assert.equal((await bearer.json() as { reached?: boolean }).reached, true)
  })

  test('login sets an HttpOnly cookie that unlocks later API calls', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    const wrong = await handler(new Request('http://library.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'nope' })
    }))
    assert.equal(wrong.status, 401)
    assert.equal(wrong.headers.get('set-cookie'), null)

    const form = await handler(new Request('http://library.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 's3cret' })
    }))
    assert.equal(form.status, 303)
    assert.equal(form.headers.get('location'), '/')
    const setCookie = form.headers.get('set-cookie') || ''
    assert.match(setCookie, new RegExp(`${SITE_AUTH_COOKIE}=`))
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /SameSite=Lax/i)
    assert.doesNotMatch(setCookie, /Secure/i)
    const token = setCookie.split(';')[0]?.split('=').slice(1).join('=')
    assert.equal(token, await siteSessionToken('s3cret'))
    assert.notEqual(token, 's3cret')

    const locked = await handler(new Request('http://library.test/api/documents', { method: 'GET' }))
    assert.equal(locked.status, 401)
    const unlocked = await handler(new Request('http://library.test/api/documents', {
      method: 'GET',
      headers: { cookie: `${SITE_AUTH_COOKIE}=${token}` }
    }))
    assert.equal(unlocked.status, 200)

    const secure = await handler(new Request('https://library.test/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 's3cret' })
    }))
    assert.equal(secure.status, 200)
    assert.match(secure.headers.get('set-cookie') || '', /Secure/i)
  })

  test('logout expires the session cookie', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    const token = await siteSessionToken('s3cret')
    const response = await handler(new Request('http://library.test/api/auth/logout', {
      method: 'POST',
      headers: { cookie: `${SITE_AUTH_COOKIE}=${token}` }
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true, redirect: '/' })
    const setCookie = response.headers.get('set-cookie') || ''
    assert.match(setCookie, new RegExp(`^${SITE_AUTH_COOKIE}=;`))
    assert.match(setCookie, /Max-Age=0/i)
    assert.match(setCookie, /Path=\//)
  })

  test('Slack events skip the password and search stays locked', async () => {
    process.env.SITE_PASSWORD = 's3cret'
    const events = await handler(new Request('http://library.test/api/slack/events', {
      method: 'POST',
      headers: { origin: 'https://hooks.slack.com', 'content-type': 'application/json' },
      body: '{}'
    }))
    assert.equal(events.status, 200)
    assert.equal((await events.json() as { reached?: boolean }).reached, true)

    const search = await handler(new Request('http://library.test/api/slack/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'čokolada' })
    }))
    assert.equal(search.status, 401)
  })

})
