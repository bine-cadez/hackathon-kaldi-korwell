import assert from 'node:assert/strict'
import { createApp, createRouter, defineEventHandler, toWebHandler } from 'h3'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { test } from 'node:test'
import oauthDiscovery from '../server/middleware/oauth-discovery.ts'
import accessGate from '../server/middleware/site-password.ts'
import authorizeRoute from '../server/routes/authorize.ts'
import tokenRoute from '../server/routes/token.ts'
import registerRoute from '../server/routes/register.ts'
import { SITE_AUTH_COOKIE } from '../server/utils/site-password.ts'
import { formActionAllows, formFields, formPostHeaders } from './helpers/browser.ts'
import { sqliteD1 } from './helpers/d1-sqlite.ts'

const secret = 'test-signing-key-must-be-32-characters-or-more'
const origin = 'https://doc-library.example'
const password = 'shared-password-test-only'
const accessIssuer = 'https://korwell-browser.cloudflareaccess.com'
const accessAudience = 'korwell-browser-audience'

function worker (env: Record<string, unknown>) {
  const app = createApp()
  app.use(defineEventHandler((event) => {
    event.context.cloudflare = { env }
  }))
  app.use(oauthDiscovery)
  app.use(accessGate)
  const router = createRouter()
  router.use('/authorize', authorizeRoute)
  router.use('/token', tokenRoute)
  router.use('/register', registerRoute)
  router.use('/mcp', defineEventHandler(() => ({ ok: true })))
  app.use(router)
  return toWebHandler(app)
}

async function challengeFor (verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function authorizeUrl (redirectUri: string, verifier: string) {
  const url = new URL('/authorize', origin)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', 'client-1')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', await challengeFor(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', 'state-1')
  url.searchParams.set('resource', `${origin}/mcp`)
  url.searchParams.set('scope', 'documents:read offline_access')
  return url.toString()
}

function cookieFrom (response: Response): string {
  const raw = response.headers.get('set-cookie') ?? ''
  const match = new RegExp(`${SITE_AUTH_COOKIE}=([^;]+)`).exec(raw)
  return match ? `${SITE_AUTH_COOKIE}=${match[1]}` : ''
}

// Submits the consent form the way Chrome would: Origin derived from the
// page's Referrer-Policy, then the CSP form-action check on the redirect.
async function submitConsent (handle: (request: Request) => Promise<Response>, page: Response, pageUrl: string, html: string, intent: 'allow' | 'deny', headers: Record<string, string>) {
  const action = '/authorize'
  assert.equal(formActionAllows(page, pageUrl, action), true, 'form-action must allow the form target')
  const body = formFields(html)
  body.set('intent', intent)
  const response = await handle(new Request(new URL(action, pageUrl), {
    method: 'POST',
    headers: formPostHeaders(page, pageUrl, action, headers),
    body: body.toString(),
    redirect: 'manual'
  }))
  return response
}

test('password mode: Chrome-style unlock, Allow, and redirect reach Claude, and the code works once', async () => {
  const DB = sqliteD1()
  const handle = worker({ SITE_PASSWORD: password, MCP_SIGNING_KEY: secret, DB })
  const verifier = 'v'.repeat(64)
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
  const start = await authorizeUrl(redirectUri, verifier)

  const locked = await handle(new Request(start))
  assert.equal(locked.status, 401)
  assert.equal(locked.headers.get('referrer-policy'), 'same-origin')
  const lockedHtml = await locked.text()
  const unlockBody = formFields(lockedHtml)
  unlockBody.set('password', password)
  unlockBody.set('intent', 'unlock')
  const unlockHeaders = formPostHeaders(locked, start, '/authorize')
  assert.equal(unlockHeaders.origin, origin, 'Chrome sends the real Origin, not null')
  const unlocked = await handle(new Request(new URL('/authorize', origin), {
    method: 'POST',
    headers: unlockHeaders,
    body: unlockBody.toString(),
    redirect: 'manual'
  }))
  assert.equal(unlocked.status, 303)
  const cookie = cookieFrom(unlocked)
  assert.ok(cookie)
  const consentUrl = unlocked.headers.get('location')!
  assert.equal(formActionAllows(locked, start, consentUrl), true)

  const consent = await handle(new Request(consentUrl, { headers: { cookie } }))
  assert.equal(consent.status, 200)
  const csp = consent.headers.get('content-security-policy') ?? ''
  assert.match(csp, /form-action 'self' https:\/\/claude\.ai(;|$)/)
  const html = await consent.text()

  const allowed = await submitConsent(handle, consent, consentUrl, html, 'allow', { cookie })
  assert.equal(allowed.status, 302)
  const location = allowed.headers.get('location')!
  assert.equal(formActionAllows(consent, consentUrl, location), true, 'CSP must not block the redirect to the client')
  const callback = new URL(location)
  assert.equal(callback.origin + callback.pathname, redirectUri)
  const code = callback.searchParams.get('code') ?? ''
  assert.ok(code)

  const exchange = () => handle(new Request(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'client-1', redirect_uri: redirectUri, code_verifier: verifier }).toString()
  }))
  const first = await exchange()
  assert.equal(first.status, 200)
  assert.equal((await first.json()).token_type, 'Bearer')
  const second = await exchange()
  assert.equal(second.status, 400)
  assert.equal((await second.json()).error, 'invalid_grant')
})

test('Deny redirects to the client, and loopback and claude.com get their own form-action origin', async () => {
  const handle = worker({ SITE_PASSWORD: password, MCP_SIGNING_KEY: secret, DB: sqliteD1() })
  const unlock = new URLSearchParams(new URL(await authorizeUrl('http://127.0.0.1:3118/callback', 'w'.repeat(64))).search)
  unlock.set('password', password)
  unlock.set('intent', 'unlock')
  const unlocked = await handle(new Request(`${origin}/authorize`, {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    body: unlock.toString()
  }))
  const cookie = cookieFrom(unlocked)

  for (const [redirectUri, expected] of [
    ['http://127.0.0.1:3118/callback', 'http://127.0.0.1:3118'],
    ['http://localhost/oauth/callback', 'http://localhost'],
    ['https://claude.com/api/mcp/auth_callback', 'https://claude.com'],
    ['https://chatgpt.com/connector_platform_oauth_redirect', 'https://chatgpt.com']
  ]) {
    const pageUrl = await authorizeUrl(redirectUri, 'w'.repeat(64))
    const page = await handle(new Request(pageUrl, { headers: { cookie } }))
    assert.equal(page.status, 200, redirectUri)
    assert.match(page.headers.get('content-security-policy') ?? '', new RegExp(`form-action 'self' ${expected.replace(/[.]/g, '\\.')};`))
    const html = await page.text()
    const denied = await submitConsent(handle, page, pageUrl, html, 'deny', { cookie })
    assert.equal(denied.status, 302)
    const location = denied.headers.get('location')!
    assert.equal(new URL(location).searchParams.get('error'), 'access_denied')
    assert.equal(formActionAllows(page, pageUrl, location), true, redirectUri)
  }
})

test('Origin: null and genuinely cross-origin consent POSTs are still rejected', async () => {
  const handle = worker({ SITE_PASSWORD: password, MCP_SIGNING_KEY: secret, DB: sqliteD1() })
  const pageUrl = await authorizeUrl('https://claude.ai/api/mcp/auth_callback', 'x'.repeat(64))
  const body = new URLSearchParams(new URL(pageUrl).search)
  body.set('password', password)
  body.set('intent', 'unlock')
  for (const headers of [
    { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'null', 'sec-fetch-site': 'same-origin' }
  ]) {
    const response = await handle(new Request(`${origin}/authorize`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }))
    assert.equal(response.status, 403, JSON.stringify(headers))
    assert.equal(response.headers.get('set-cookie'), null)
  }
})

test('Access mode: Chrome-style Allow passes the Access gate and redirects to ChatGPT', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'browser-key' }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ keys: [jwk] }))
  const assertion = await new SignJWT({ email: 'reader@kaldi.si' })
    .setProtectedHeader({ alg: 'RS256', kid: 'browser-key' })
    .setIssuer(accessIssuer)
    .setAudience([accessAudience])
    .setSubject('reader-access-id')
    .setExpirationTime('5m')
    .sign(privateKey)
  const handle = worker({ ACCESS_TEAM_DOMAIN: accessIssuer, ACCESS_AUD: accessAudience, MCP_SIGNING_KEY: secret, DB: sqliteD1() })
  const access = { 'cf-access-jwt-assertion': assertion }
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'
  const pageUrl = await authorizeUrl(redirectUri, 'y'.repeat(64))

  const page = await handle(new Request(pageUrl, { headers: access }))
  assert.equal(page.status, 200)
  assert.equal(page.headers.get('referrer-policy'), 'same-origin')
  const html = await page.text()
  assert.match(html, /reader@kaldi\.si/)
  const allowed = await submitConsent(handle, page, pageUrl, html, 'allow', access)
  assert.equal(allowed.status, 302)
  const location = allowed.headers.get('location')!
  assert.equal(formActionAllows(page, pageUrl, location), true)
  assert.ok(new URL(location).searchParams.get('code'))

  // The old header would have produced Origin: null, which the Access gate rejects.
  const nullOrigin = await handle(new Request(`${origin}/authorize`, {
    method: 'POST',
    headers: { ...access, origin: 'null', 'content-type': 'application/x-www-form-urlencoded' },
    body: formFields(html).toString()
  }))
  assert.equal(nullOrigin.status, 403)
})

test('half-configured Access fails closed on MCP and OAuth machine routes', async () => {
  const handle = worker({ ACCESS_TEAM_DOMAIN: accessIssuer, MCP_SIGNING_KEY: secret, DB: sqliteD1() })
  for (const [path, method] of [
    ['/mcp', 'POST'],
    ['/mcp', 'GET'],
    ['/token', 'POST'],
    ['/register', 'POST'],
    ['/authorize', 'GET'],
    ['/.well-known/oauth-protected-resource/mcp', 'GET'],
    ['/.well-known/oauth-authorization-server', 'GET']
  ]) {
    const response = await handle(new Request(`${origin}${path}`, { method }))
    assert.equal(response.status, 503, `${method} ${path}`)
  }
})

test('a D1 failure at /token is a 503 OAuth JSON error, not the HTML unlock page', async () => {
  const brokenDb = {
    prepare () {
      throw new Error('D1_ERROR: database is locked')
    }
  }
  const handle = worker({ SITE_PASSWORD: password, MCP_SIGNING_KEY: secret, DB: brokenDb })
  const verifier = 'z'.repeat(64)
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
  // Get a valid code first, through the password flow.
  const unlock = new URLSearchParams(new URL(await authorizeUrl(redirectUri, verifier)).search)
  unlock.set('password', password)
  unlock.set('intent', 'unlock')
  const unlocked = await handle(new Request(`${origin}/authorize`, {
    method: 'POST',
    headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/x-www-form-urlencoded' },
    body: unlock.toString()
  }))
  const cookie = cookieFrom(unlocked)
  const pageUrl = unlocked.headers.get('location')!
  const page = await handle(new Request(pageUrl, { headers: { cookie } }))
  const allowed = await submitConsent(handle, page, pageUrl, await page.text(), 'allow', { cookie })
  const code = new URL(allowed.headers.get('location')!).searchParams.get('code') ?? ''
  assert.ok(code)

  const response = await handle(new Request(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'client-1', redirect_uri: redirectUri, code_verifier: verifier }).toString()
  }))
  assert.equal(response.status, 503)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  const body = await response.json()
  assert.equal(body.error, 'server_error')
  assert.doesNotMatch(JSON.stringify(body), /D1_ERROR|locked/)

  const garbled = await handle(new Request(`${origin}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json'
  }))
  assert.equal(garbled.status, 400)
  assert.equal((await garbled.json()).error, 'invalid_request')
})
