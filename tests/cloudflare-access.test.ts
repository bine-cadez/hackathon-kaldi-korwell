import assert from 'node:assert/strict'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { test } from 'node:test'
import accessGate from '../server/middleware/site-password.ts'
import { SITE_AUTH_COOKIE, siteSessionToken } from '../server/utils/site-password.ts'

const issuer = 'https://korwell-test.cloudflareaccess.com'
const audience = 'korwell-pilot-audience'
const password = 'shared-password-test-only'
const origin = 'https://korwell.example'

function worker (teamDomain = issuer, aud = audience) {
  const app = createApp()
  app.use(defineEventHandler((event) => {
    event.context.cloudflare = { env: { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: aud, SITE_PASSWORD: password } }
  }))
  app.use(accessGate)
  app.use(defineEventHandler(event => ({ user: event.context.korwellAccessUser ?? null })))
  return toWebHandler(app)
}

test('partial Access configuration keeps the API closed', async () => {
  const response = await worker(issuer, '')(new Request(origin + '/api/documents', {
    headers: { 'x-site-password': password }
  }))
  assert.equal(response.status, 503)
})

test('signed Access assertions gate the pages and API and supply the verified user', async (t) => {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const unrelatedKey = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), alg: 'RS256', kid: 'pilot-key' }
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(String(input), issuer + '/cdn-cgi/access/certs')
    return Response.json({ keys: [jwk] })
  })

  const handle = worker()
  const signed = (options: {
    email?: string
    issuer?: string
    audience?: string
    expiry?: number | string
    key?: CryptoKey
  } = {}) => new SignJWT({ email: options.email ?? 'coworker@kaldi.si' })
    .setProtectedHeader({ alg: 'RS256', kid: 'pilot-key' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience([options.audience ?? audience])
    .setSubject('coworker-access-id')
    .setExpirationTime(options.expiry ?? '5m')
    .sign(options.key ?? privateKey)

  const request = (path: string, headers?: HeadersInit, method = 'GET') =>
    handle(new Request(origin + path, { method, headers }))

  assert.equal((await request('/api/health')).status, 200)
  assert.equal((await request('/')).status, 401)
  assert.equal((await request('/api/search', undefined, 'POST')).status, 401)
  assert.equal((await request('/api/documents', {
    'x-site-password': password,
    cookie: `${SITE_AUTH_COOKIE}=${await siteSessionToken(password)}`,
    'cf-access-authenticated-user-email': 'coworker@kaldi.si'
  })).status, 401)

  for (const token of [
    await signed({ audience: 'wrong-audience' }),
    await signed({ issuer: 'https://another-team.cloudflareaccess.com' }),
    await signed({ expiry: 1 }),
    await signed({ email: 'coworker@kaldi.si.example' }),
    await signed({ key: unrelatedKey.privateKey })
  ]) {
    assert.equal((await request('/api/documents', { 'cf-access-jwt-assertion': token })).status, 401)
  }

  const headers = { 'cf-access-jwt-assertion': await signed() }
  const response = await request('/api/documents', headers)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.deepEqual(await response.json(), { user: { id: 'coworker-access-id', email: 'coworker@kaldi.si' } })
  assert.equal((await request('/api/search', { ...headers, origin }, 'POST')).status, 200)
  assert.equal((await request('/api/search', { ...headers, origin: 'https://other.example' }, 'POST')).status, 403)
  assert.equal((await request('/api/auth/login', headers, 'POST')).status, 404)
})
