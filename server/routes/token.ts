import { defineEventHandler, readBody, setResponseHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { publicRequestURL } from '../utils/mcp-request.ts'
import { exchangeToken, mcpSigningKeyFromEvent, OAuthError } from '../utils/mcp-auth.ts'
import { corsHeaders } from '../utils/mcp-http.ts'
import { d1UsedCodeStore, type CodeStoreDatabase } from '../utils/mcp-code-store.ts'

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, {
    ...corsHeaders(),
    'cache-control': 'no-store',
    pragma: 'no-cache',
    'x-robots-tag': 'noindex, nofollow'
  })
  if (event.method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return null
  }
  if (event.method !== 'POST') {
    setResponseStatus(event, 405)
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return { error: 'invalid_request', error_description: 'POST is required' }
  }
  try {
    const body = await readBody(event)
    const db = (event.context.cloudflare?.env as { DB?: CodeStoreDatabase } | undefined)?.DB
    const token = await exchangeToken(mcpSigningKeyFromEvent(event), publicRequestURL(event).origin, body, d1UsedCodeStore(db))
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return token
  } catch (error) {
    if (error instanceof OAuthError) {
      setResponseStatus(event, error.status)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: error.code, error_description: error.description }
    }
    // A body h3 could not parse is the client's fault.
    const status = (error as { statusCode?: unknown })?.statusCode
    if (typeof status === 'number' && status >= 400 && status < 500) {
      setResponseStatus(event, 400)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: 'invalid_request', error_description: 'The request body could not be read' }
    }
    // D1 or any other failure: answer in OAuth JSON, never fall through to the
    // HTML unlock page. Details go to the log only.
    console.error(JSON.stringify({ message: 'mcp_token_failed', error: error instanceof Error ? error.message.slice(0, 300) : 'unknown' }))
    setResponseStatus(event, 503)
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return { error: 'server_error', error_description: 'The token endpoint is temporarily unavailable' }
  }
})
