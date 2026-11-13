import assert from 'node:assert/strict'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { test } from 'node:test'
import { createMcpHandler } from '../server/utils/mcp-http.ts'
import { callTool, handleJsonRpc, listTools, type LibraryApi } from '../server/utils/mcp-protocol.ts'
import accessGate from '../server/middleware/site-password.ts'
import oauthDiscovery from '../server/middleware/oauth-discovery.ts'

const secret = 'test-signing-key-must-be-32-characters-or-more'
const origin = 'https://doc-library.example'

function library (slack = false): LibraryApi & { calls: Array<{ query: string, topK: number, filters?: unknown }> } {
  const calls: Array<{ query: string, topK: number, filters?: unknown }> = []
  return {
    calls,
    async searchDocuments (_env, _apiKey, query, topK, filters) {
      calls.push({ query, topK, filters })
      return {
        matches: [
          { documentId: 'doc-1', title: 'Quarterly plan', content: 'chunk a', score: 0.9 },
          { documentId: 'doc-1', title: 'Quarterly plan', content: 'chunk b', score: 0.8 },
          { documentId: 'doc-2', title: 'Notes', content: 'other', score: 0.2 }
        ]
      }
    },
    async getDocument (_env, id) {
      if (id !== 'doc-1') {
        const error = new Error('Document not found') as Error & { statusCode?: number }
        error.statusCode = 404
        throw error
      }
      return { id, title: 'Quarterly plan', body: 'Full text of the plan.', createdAt: '2026-05-01T00:00:00.000Z', author: 'Ada' }
    },
    slackSearch: slack
      ? async () => ({
          configured: true as const,
          matches: [{
            channelId: 'C1',
            channelName: 'general',
            ts: '1.2',
            sentAt: '2026-05-01T00:00:00.000Z',
            userDisplayName: 'Ada',
            text: 'ship the library',
            permalink: 'https://kaldi.slack.com/archives/C1/p12'
          }]
        })
      : null,
    slackReady: async () => slack
  }
}

async function accessToken () {
  const { SignJWT } = await import('jose')
  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({ email: 'reader@kaldi.si', scope: 'documents:read', client_id: 'client-1' })
    .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt' })
    .setIssuer(origin)
    .setAudience(`${origin}/mcp`)
    .setSubject('user-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(new TextEncoder().encode(secret))
}

test('search and fetch match the ChatGPT result shapes and pass filters through', async () => {
  const api = library()
  const tools = await listTools(api, {})
  assert.deepEqual(tools.map(tool => tool.name), ['search', 'fetch'])
  const search = tools.find(tool => tool.name === 'search')
  assert.deepEqual(search?.inputSchema.required, ['query'])
  assert.equal(search?.annotations.readOnlyHint, true)
  assert.equal(search?.outputSchema.required.includes('results'), true)
  const fetch = tools.find(tool => tool.name === 'fetch')
  assert.deepEqual(fetch?.inputSchema.required, ['id'])

  const found = await callTool(api, {}, 'key', origin, 'search', {
    arguments: { query: 'plan', limit: 5, from: '2026-05-01', to: '2026-05-31', author: 'Ada' }
  })
  const payload = JSON.parse(found.content[0].text)
  assert.deepEqual(payload, found.structuredContent)
  assert.deepEqual(payload.results, [
    { id: 'doc-1', title: 'Quarterly plan', url: `${origin}/library/doc-1` },
    { id: 'doc-2', title: 'Notes', url: `${origin}/library/doc-2` }
  ])
  assert.deepEqual(api.calls[0], {
    query: 'plan',
    topK: 15,
    filters: { from: '2026-05-01', to: '2026-05-31', author: 'Ada' }
  })

  const document = await callTool(api, {}, 'key', origin, 'fetch', { arguments: { id: 'doc-1' } })
  assert.deepEqual(document.structuredContent, {
    id: 'doc-1',
    title: 'Quarterly plan',
    text: 'Full text of the plan.',
    url: `${origin}/library/doc-1`,
    metadata: { source: 'korwell-documents', created_at: '2026-05-01T00:00:00.000Z', author: 'Ada' }
  })
  const missing = await callTool(api, {}, 'key', origin, 'fetch', { arguments: { id: 'missing' } })
  assert.equal(missing.isError, true)
})

test('initialize and tools/list answer JSON-RPC and notifications are empty', async () => {
  const api = library()
  const init = await handleJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } }
  }, api, {}, '', origin, null)
  assert.equal(init.status, 200)
  assert.equal((init.body as { result: { protocolVersion: string } }).result.protocolVersion, '2025-11-25')
  const listed = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, api, {}, '', origin, '2025-06-18')
  const names = ((listed.body as { result: { tools: Array<{ name: string }> } }).result.tools).map(tool => tool.name)
  assert.deepEqual(names, ['search', 'fetch'])
  const note = await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, api, {}, '', origin, null)
  assert.equal(note.status, 202)
  const batch = await handleJsonRpc([], api, {}, '', origin, null)
  assert.equal(batch.status, 400)
})

test('the HTTP endpoint requires a bearer token and returns search results', async () => {
  const api = library()
  const app = createApp()
  app.use(createMcpHandler({
    library: api,
    signingKey: () => secret,
    apiKey: () => 'test-key',
    env: () => ({})
  }))
  const handle = toWebHandler(app)
  const missing = await handle(new Request(`${origin}/mcp`, { method: 'POST', body: '{}' }))
  assert.equal(missing.status, 401)
  const challenge = missing.headers.get('www-authenticate') ?? ''
  assert.match(challenge, /resource_metadata="https:\/\/doc-library\.example\/\.well-known\/oauth-protected-resource\/mcp"/)
  assert.match(challenge, /scope="documents:read"/)

  const token = await accessToken()
  const denied = await handle(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, origin: 'https://evil.example', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
  }))
  assert.equal(denied.status, 403)

  const ping = await handle(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'plan' } } })
  }))
  assert.equal(ping.status, 200)
  const body = await ping.json() as { result: { structuredContent: { results: Array<{ id: string }> } } }
  assert.equal(body.result.structuredContent.results[0].id, 'doc-1')

  const sse = await handle(new Request(`${origin}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })
  }))
  assert.equal(sse.headers.get('content-type')?.includes('text/event-stream'), true)
  assert.match(await sse.text(), /event: message/)

  const get = await handle(new Request(`${origin}/mcp`, { headers: { authorization: `Bearer ${token}` } }))
  assert.equal(get.status, 405)

  const open = createApp()
  open.use(createMcpHandler({
    library: api,
    signingKey: () => '',
    apiKey: () => '',
    env: () => ({})
  }))
  const closed = await toWebHandler(open)(new Request(`${origin}/mcp`, { method: 'POST' }))
  assert.equal(closed.status, 503)
})

test('Access and the site password do not block MCP machine routes', async () => {
  const password = 'shared-password-test-only'
  function worker (env: Record<string, string>) {
    const app = createApp()
    app.use(defineEventHandler((event) => {
      event.context.cloudflare = { env }
    }))
    app.use(oauthDiscovery)
    app.use(accessGate)
    app.use(defineEventHandler(() => ({ ok: true })))
    return toWebHandler(app)
  }
  const locked = worker({ SITE_PASSWORD: password })
  assert.equal((await locked(new Request(`${origin}/api/search`, { method: 'POST' }))).status, 401)
  assert.equal((await locked(new Request(`${origin}/mcp`, { method: 'POST' }))).status, 200)
  const discovery = await locked(new Request(`${origin}/.well-known/oauth-protected-resource`))
  assert.equal(discovery.status, 200)
  assert.equal((await discovery.json()).resource, `${origin}/mcp`)
  assert.equal((await locked(new Request(`${origin}/authorize`))).status, 200)

  const access = worker({ ACCESS_TEAM_DOMAIN: 'https://korwell-test.cloudflareaccess.com', ACCESS_AUD: 'aud', SITE_PASSWORD: password })
  assert.equal((await access(new Request(`${origin}/`))).status, 401)
  assert.equal((await access(new Request(`${origin}/authorize`))).status, 401)
  assert.equal((await access(new Request(`${origin}/mcp`, { method: 'POST' }))).status, 200)
  assert.equal((await access(new Request(`${origin}/token`, { method: 'POST' }))).status, 200)
  assert.equal((await access(new Request(`${origin}/register`, { method: 'POST' }))).status, 200)
})

test('tool errors return fixed messages, never upstream text', async () => {
  const leaky: LibraryApi = {
    ...library(),
    async searchDocuments () {
      throw new Error('OpenRouter 401: invalid key sk-or-v1-abc for account bine@kaldi.si')
    }
  }
  const failed = await callTool(leaky, {}, 'sk-or-v1-abc', origin, 'search', { arguments: { query: 'plan' } })
  assert.equal(failed.isError, true)
  const text = failed.content[0].text
  assert.doesNotMatch(text, /OpenRouter|sk-or|kaldi\.si/)
  assert.match(text, /could not complete/)
  const missing = await callTool(library(), {}, '', origin, 'fetch', { arguments: { id: 'nope' } })
  assert.equal(missing.content[0].text, 'Document not found')
  const unknown = await callTool(library(), {}, '', origin, '<script>', {})
  assert.equal(unknown.content[0].text, 'Unknown tool')
})
