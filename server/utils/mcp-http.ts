import { defineEventHandler, getHeader, readRawBody, setResponseHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { publicRequestURL } from './mcp-request.ts'
import { signingKeyProblem, verifyAccessToken, wwwAuthenticate } from './mcp-auth.ts'
import { handleJsonRpc, type LibraryApi } from './mcp-protocol.ts'

const BODY_LIMIT = 1_000_000
const ALLOWED_ORIGIN_HOSTS = new Set([
  'claude.ai',
  'www.claude.ai',
  'claude.com',
  'chatgpt.com',
  'chat.openai.com'
])

export interface McpHandlerDeps {
  library: LibraryApi
  signingKey: (event: McpEvent) => string
  apiKey: (event: McpEvent) => string
  env: (event: McpEvent) => unknown
}

interface McpEvent {
  method: string
  headers: Headers
  context?: { cloudflare?: { env?: { MCP_SIGNING_KEY?: string } } }
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
}

function headerList (value: string | null): string[] {
  if (!value) return []
  return value.split(',').map(part => part.split(';')[0]?.trim().toLowerCase() ?? '').filter(Boolean)
}

function accepted (header: string | null): 'json' | 'sse' | 'none' {
  const types = headerList(header)
  if (types.length === 0) return 'json'
  if (types.includes('application/json') || types.includes('*/*')) return 'json'
  if (types.includes('text/event-stream')) return 'sse'
  return 'none'
}

function originAllowed (requestOrigin: string | null, resource: URL): boolean {
  if (!requestOrigin) return true
  let url: URL
  try {
    url = new URL(requestOrigin)
  } catch {
    return false
  }
  if (url.origin === resource.origin) return true
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1') return true
  return ALLOWED_ORIGIN_HOSTS.has(url.hostname)
}

export function corsHeaders (): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, GET, DELETE, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
    'access-control-expose-headers': 'www-authenticate, mcp-protocol-version',
    'access-control-max-age': '600'
  }
}

function bearerToken (header: string | null): string {
  if (!header) return ''
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header)
  return match?.[1] ?? ''
}

export function createMcpHandler (deps: McpHandlerDeps) {
  return defineEventHandler(async (event) => {
    const url = publicRequestURL(event)
    const method = event.method.toUpperCase()
    setResponseHeaders(event, {
      ...corsHeaders(),
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow'
    })

    if (method === 'OPTIONS') {
      setResponseStatus(event, 204)
      return null
    }

    if (!originAllowed(getHeader(event, 'origin') ?? null, url)) {
      setResponseStatus(event, 403)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: 'forbidden', error_description: 'Origin is not allowed' }
    }

    const secret = deps.signingKey(event)
    const keyProblem = signingKeyProblem(secret)
    if (keyProblem) {
      setResponseStatus(event, 503)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: 'server_error', error_description: keyProblem }
    }

    const token = bearerToken(getHeader(event, 'authorization') ?? null)
    const claims = token ? await verifyAccessToken(token, secret, url.origin) : null
    if (!claims) {
      setResponseStatus(event, 401)
      setResponseHeader(event, 'www-authenticate', wwwAuthenticate(url.origin))
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      console.log(JSON.stringify({ message: 'mcp_unauthorized', method }))
      return { error: 'invalid_token', error_description: 'Authentication required' }
    }

    if (method !== 'POST') {
      setResponseStatus(event, 405)
      setResponseHeader(event, 'allow', 'POST')
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: 'method_not_allowed', error_description: 'This server is stateless. Send JSON-RPC with POST.' }
    }

    const accept = accepted(getHeader(event, 'accept') ?? null)
    if (accept === 'none') {
      setResponseStatus(event, 406)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: 'not_acceptable', error_description: 'Accept must include application/json or text/event-stream' }
    }

    const length = Number(getHeader(event, 'content-length') || 0)
    if (Number.isFinite(length) && length > BODY_LIMIT) {
      setResponseStatus(event, 413)
      return { error: 'payload_too_large' }
    }
    const raw = await readRawBody(event, 'utf8')
    if (raw && raw.length > BODY_LIMIT) {
      setResponseStatus(event, 413)
      return { error: 'payload_too_large' }
    }

    let parsed: unknown
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      setResponseStatus(event, 400)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }
    }

    const outcome = await handleJsonRpc(
      parsed,
      deps.library,
      deps.env(event),
      deps.apiKey(event),
      url.origin,
      getHeader(event, 'mcp-protocol-version') ?? null
    )
    setResponseStatus(event, outcome.status)
    if (outcome.protocolVersion) setResponseHeader(event, 'mcp-protocol-version', outcome.protocolVersion)
    if (outcome.status === 202) return null
    if (accept === 'sse') {
      setResponseHeader(event, 'content-type', 'text/event-stream; charset=utf-8')
      return `event: message\ndata: ${JSON.stringify(outcome.body)}\n\n`
    }
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return outcome.body
  })
}
