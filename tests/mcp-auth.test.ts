import assert from 'node:assert/strict'
import { createApp, toWebHandler } from 'h3'
import { decodeJwt } from 'jose'
import { mock, test } from 'node:test'
import oauthDiscovery from '../server/middleware/oauth-discovery.ts'
import {
  authorizationServerMetadata,
  exchangeToken,
  protectedResourceMetadata,
  redirectAllowed,
  REFRESH_TOKEN_TTL_SECONDS,
  registerClient,
  type UsedCodeStore,
  verifyAccessToken,
  wwwAuthenticate
} from '../server/utils/mcp-auth.ts'
import { handleAuthorize as authorize } from '../server/utils/mcp-authorize.ts'
import { d1UsedCodeStore } from '../server/utils/mcp-code-store.ts'
import { sqliteD1 } from './helpers/d1-sqlite.ts'

const secret = 'test-signing-key-must-be-32-characters-or-more'
const origin = 'https://doc-library.example'

function authorizeQuery (redirectUri: string, challenge: string) {
  const url = new URL('/authorize', origin)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', 'client-1')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', 'state-1')
  url.searchParams.set('resource', `${origin}/mcp`)
  url.searchParams.set('scope', 'documents:read offline_access')
  return url
}

async function challengeFor (verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  let binary = ''
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

test('redirect allowlist accepts Claude, ChatGPT, and loopback only', () => {
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(redirectAllowed('https://claude.com/api/mcp/auth_callback'), true)
  assert.equal(redirectAllowed('https://claude.com/other'), false)
  assert.equal(redirectAllowed('https://claude.ai:443/api/mcp/auth_callback'), true)
  assert.equal(redirectAllowed('https://claude.ai:8443/api/mcp/auth_callback'), false)
  assert.equal(redirectAllowed('https://claude.com:8443/api/mcp/auth_callback'), false)
  assert.equal(redirectAllowed('https://chatgpt.com:444/connector_platform_oauth_redirect'), false)
  assert.equal(redirectAllowed('https://chatgpt.com:8443/connector/oauth/cb_1'), false)
  assert.equal(redirectAllowed('http://[::1]:3118/callback'), false)
  assert.equal(redirectAllowed('http://[::1]/oauth/callback'), false)
  assert.equal(redirectAllowed('https://chatgpt.com/connector_platform_oauth_redirect'), true)
  assert.equal(redirectAllowed('https://chatgpt.com/connector/oauth/cb_123-abc'), true)
  assert.equal(redirectAllowed('http://127.0.0.1:3118/callback'), true)
  assert.equal(redirectAllowed('http://localhost:8787/callback'), true)
  assert.equal(redirectAllowed('http://localhost/oauth/callback'), true)
  assert.equal(redirectAllowed('https://claude.ai.evil.com/api/mcp/auth_callback'), false)
  assert.equal(redirectAllowed('https://user:pass@claude.ai/api/mcp/auth_callback'), false)
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback?next=1'), false)
  assert.equal(redirectAllowed('https://claude.ai/api/mcp/auth_callback#code'), false)
  assert.equal(redirectAllowed('http://localhost.evil.com/callback'), false)
  assert.equal(redirectAllowed('https://evil.example/callback'), false)
})

test('discovery documents agree on the issuer and the MCP resource', () => {
  const resource = protectedResourceMetadata(origin)
  const server = authorizationServerMetadata(origin)
  assert.equal(resource.resource, `${origin}/mcp`)
  assert.deepEqual(resource.authorization_servers, [origin])
  assert.equal(server.issuer, origin)
  assert.deepEqual(server.code_challenge_methods_supported, ['S256'])
  assert.equal(server.authorization_response_iss_parameter_supported, true)
  assert.equal(server.registration_endpoint, `${origin}/register`)
  assert.equal('client_id_metadata_document_supported' in server, false)
  assert.equal(wwwAuthenticate(origin).includes(`${origin}/.well-known/oauth-protected-resource/mcp`), true)
})

test('discovery middleware serves both well-known documents', async () => {
  const app = createApp()
  app.use(oauthDiscovery)
  const handle = toWebHandler(app)
  const resource = await handle(new Request(`${origin}/.well-known/oauth-protected-resource/mcp`))
  assert.equal(resource.status, 200)
  assert.equal((await resource.json()).resource, `${origin}/mcp`)
  const server = await handle(new Request(`${origin}/.well-known/oauth-authorization-server`))
  assert.equal((await server.json()).issuer, origin)
  const other = await handle(new Request(`${origin}/api/health`))
  assert.equal(other.status, 404)
})

test('registration rejects unknown redirects and accepts Claude', () => {
  assert.throws(() => registerClient(secret, {
    redirect_uris: ['https://evil.example/callback']
  }), (error: unknown) => (error as { code?: string }).code === 'invalid_redirect_uri')
  const client = registerClient(secret, {
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
    client_name: 'Claude',
    token_endpoint_auth_method: 'none'
  })
  assert.equal(client.token_endpoint_auth_method, 'none')
  assert.equal('client_secret' in client, false)
  assert.throws(() => registerClient('short', { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    (error: unknown) => (error as { status?: number, description?: string }).status === 503 && /too short/.test((error as { description: string }).description))
  assert.throws(() => registerClient('', { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    (error: unknown) => /is not set/.test((error as { description: string }).description))
})

test('authorization code, PKCE, refresh, and audience are enforced', async () => {
  const verifier = 'a'.repeat(48)
  const challenge = await challengeFor(verifier)
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect'
  const url = authorizeQuery(redirectUri, challenge)
  const consent = await authorize({
    method: 'GET',
    url,
    accessMode: 'enabled',
    accessUser: { id: 'user-1', email: 'reader@kaldi.si' },
    sitePassword: '',
    sessionCookie: null,
    signingKey: secret,
    form: null,
    dev: false,
    originHeader: null,
    fetchSite: null
  })
  assert.equal(consent.status, 200)
  assert.match(consent.body, /ChatGPT/)
  assert.match(consent.body, /reader@kaldi\.si/)
  const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)?.[1] ?? ''
  assert.ok(csrf)

  const allowed = await authorize({
    method: 'POST',
    url: new URL('/authorize', origin),
    accessMode: 'enabled',
    accessUser: { id: 'user-1', email: 'reader@kaldi.si' },
    sitePassword: '',
    sessionCookie: null,
    signingKey: secret,
    form: {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'state-1',
      resource: `${origin}/mcp`,
      scope: 'documents:read offline_access',
      intent: 'allow',
      csrf
    },
    dev: false,
    originHeader: origin,
    fetchSite: 'same-origin'
  })
  assert.equal(allowed.status, 302)
  const location = new URL(allowed.headers.location)
  assert.equal(location.origin + location.pathname, redirectUri)
  assert.equal(location.searchParams.get('iss'), origin)
  assert.equal(location.searchParams.get('state'), 'state-1')
  const code = location.searchParams.get('code') ?? ''

  const store = d1UsedCodeStore(sqliteD1())
  // A wrong verifier fails PKCE and must not burn the code.
  await assert.rejects(exchangeToken(secret, origin, {
    grant_type: 'authorization_code',
    code,
    client_id: 'client-1',
    redirect_uri: redirectUri,
    code_verifier: 'b'.repeat(48)
  }, store), (error: unknown) => (error as { code?: string }).code === 'invalid_grant')

  const redeem = {
    grant_type: 'authorization_code',
    code,
    client_id: 'client-1',
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: `${origin}/mcp`
  }
  const token = await exchangeToken(secret, origin, redeem, store)
  await assert.rejects(exchangeToken(secret, origin, redeem, store),
    (error: unknown) => (error as { code?: string, description?: string }).code === 'invalid_grant' && /already used/.test((error as { description: string }).description))
  await assert.rejects(exchangeToken(secret, origin, redeem, null),
    (error: unknown) => (error as { status?: number }).status === 503)
  assert.equal(token.token_type, 'Bearer')
  assert.equal(token.expires_in, 3600)
  const access = String(token.access_token)
  const claims = await verifyAccessToken(access, secret, origin)
  assert.equal(claims?.email, 'reader@kaldi.si')
  assert.equal(await verifyAccessToken(access, secret, 'https://other.example'), null)
  assert.equal(await verifyAccessToken(String(token.refresh_token), secret, origin), null)
  assert.equal(await verifyAccessToken(access, 'another-signing-key-that-is-long-enough', origin), null)

  const refreshed = await exchangeToken(secret, origin, {
    grant_type: 'refresh_token',
    refresh_token: token.refresh_token,
    client_id: 'client-1'
  }, store)
  assert.notEqual(refreshed.access_token, access)
  assert.equal((await verifyAccessToken(String(refreshed.access_token), secret, origin))?.sub, 'user-1')
})

test('plain PKCE and a foreign resource are rejected at authorize', async () => {
  const url = authorizeQuery('https://claude.ai/api/mcp/auth_callback', 'a'.repeat(43))
  url.searchParams.set('code_challenge_method', 'plain')
  const result = await authorize({
    method: 'GET',
    url,
    accessMode: 'enabled',
    accessUser: { id: 'user-1', email: 'reader@kaldi.si' },
    sitePassword: '',
    sessionCookie: null,
    signingKey: secret,
    form: null,
    dev: false,
    originHeader: null,
    fetchSite: null
  })
  assert.equal(result.status, 302)
  const location = new URL(result.headers.location)
  assert.equal(location.searchParams.get('error'), 'invalid_request')
  assert.equal(location.searchParams.get('iss'), origin)
})

test('site password blocks consent until the right password is posted', async () => {
  const url = authorizeQuery('https://claude.ai/api/mcp/auth_callback', 'a'.repeat(43))
  const locked = await authorize({
    method: 'GET',
    url,
    accessMode: 'disabled',
    accessUser: null,
    sitePassword: 'shared-password',
    sessionCookie: null,
    signingKey: secret,
    form: null,
    dev: false,
    originHeader: null,
    fetchSite: null
  })
  assert.equal(locked.status, 401)
  assert.match(locked.body, /name="password"/)
  assert.equal(locked.sessionCookie, undefined)

  const unlocked = await authorize({
    method: 'POST',
    url: new URL('/authorize', origin),
    accessMode: 'disabled',
    accessUser: null,
    sitePassword: 'shared-password',
    sessionCookie: null,
    signingKey: secret,
    form: {
      password: 'shared-password',
      intent: 'unlock',
      redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      client_id: 'client-1',
      response_type: 'code',
      code_challenge: 'a'.repeat(43),
      code_challenge_method: 'S256',
      state: 'state-1',
      resource: `${origin}/mcp`
    },
    dev: false,
    originHeader: origin,
    fetchSite: 'same-origin'
  })
  assert.equal(unlocked.status, 303)
  assert.ok(unlocked.sessionCookie)
  assert.match(unlocked.headers.location, /redirect_uri=/)
  assert.doesNotMatch(unlocked.headers.location, /^https:\/\/claude\.ai/)
})

test('an unlocked production site does not mint anonymous MCP codes', async () => {
  const result = await authorize({
    method: 'GET',
    url: authorizeQuery('https://claude.ai/api/mcp/auth_callback', 'a'.repeat(43)),
    accessMode: 'disabled',
    accessUser: null,
    sitePassword: '',
    sessionCookie: null,
    signingKey: secret,
    form: null,
    dev: false,
    originHeader: null,
    fetchSite: null
  })
  assert.equal(result.status, 503)
})

async function codeFor (redirectUri: string, verifier: string, user = { id: 'user-1', email: 'reader@kaldi.si' }) {
  const challenge = await challengeFor(verifier)
  const page = await authorize({
    method: 'GET', url: authorizeQuery(redirectUri, challenge), accessMode: 'enabled', accessUser: user,
    sitePassword: '', sessionCookie: null, signingKey: secret, form: null, dev: false, originHeader: null, fetchSite: null
  })
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.body)?.[1] ?? ''
  const allowed = await authorize({
    method: 'POST', url: new URL('/authorize', origin), accessMode: 'enabled', accessUser: user,
    sitePassword: '', sessionCookie: null, signingKey: secret, dev: false, originHeader: origin, fetchSite: 'same-origin',
    form: {
      response_type: 'code', client_id: 'client-1', redirect_uri: redirectUri, code_challenge: challenge,
      code_challenge_method: 'S256', state: 'state-1', resource: `${origin}/mcp`, scope: 'documents:read offline_access', intent: 'allow', csrf
    }
  })
  return new URL(allowed.headers.location).searchParams.get('code') ?? ''
}

test('concurrent redemptions of one code: exactly one wins', async () => {
  const verifier = 'c'.repeat(48)
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
  const code = await codeFor(redirectUri, verifier)
  const store = d1UsedCodeStore(sqliteD1())
  const body = { grant_type: 'authorization_code', code, client_id: 'client-1', redirect_uri: redirectUri, code_verifier: verifier }
  const results = await Promise.allSettled([1, 2, 3].map(() => exchangeToken(secret, origin, body, store)))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
})

test('refreshing never extends the chain past the original approval plus 30 days', async (t) => {
  const start = Date.UTC(2026, 10, 1, 12, 0, 0)
  mock.timers.enable({ apis: ['Date'], now: start })
  t.after(() => mock.timers.reset())
  const verifier = 'r'.repeat(48)
  const redirectUri = 'https://claude.ai/api/mcp/auth_callback'
  const store: UsedCodeStore = { consume: async () => true }
  const code = await codeFor(redirectUri, verifier)
  const first = await exchangeToken(secret, origin, { grant_type: 'authorization_code', code, client_id: 'client-1', redirect_uri: redirectUri, code_verifier: verifier }, store)
  const chainEnd = Math.floor(start / 1000) + REFRESH_TOKEN_TTL_SECONDS
  assert.equal(decodeJwt(String(first.refresh_token)).exp, chainEnd)

  // Day 20: the new refresh token keeps the same end date.
  mock.timers.setTime(start + 20 * 86400_000)
  const day20 = await exchangeToken(secret, origin, { grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: 'client-1' }, store)
  assert.equal(decodeJwt(String(day20.refresh_token)).exp, chainEnd)
  assert.equal(day20.expires_in, 3600)

  // 30 minutes before the end, the access token is cut to the remaining time.
  mock.timers.setTime((chainEnd - 30 * 60) * 1000)
  const late = await exchangeToken(secret, origin, { grant_type: 'refresh_token', refresh_token: day20.refresh_token, client_id: 'client-1' }, store)
  assert.equal(late.expires_in, 30 * 60)
  assert.equal(decodeJwt(String(late.access_token)).exp, chainEnd)
  assert.equal(decodeJwt(String(late.refresh_token)).exp, chainEnd)

  // After the end, every refresh token in the chain is dead, even within clock tolerance.
  mock.timers.setTime((chainEnd + 30) * 1000)
  for (const refresh of [first.refresh_token, day20.refresh_token, late.refresh_token]) {
    await assert.rejects(exchangeToken(secret, origin, { grant_type: 'refresh_token', refresh_token: refresh, client_id: 'client-1' }, store),
      (error: unknown) => (error as { code?: string }).code === 'invalid_grant')
  }
})
