import { defineEventHandler, readBody, setResponseHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { mcpSigningKeyFromEvent, OAuthError, registerClient } from '../utils/mcp-auth.ts'
import { corsHeaders } from '../utils/mcp-http.ts'

export default defineEventHandler(async (event) => {
  setResponseHeaders(event, {
    ...corsHeaders(),
    'cache-control': 'no-store',
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
    const client = registerClient(mcpSigningKeyFromEvent(event), await readBody(event))
    setResponseStatus(event, 201)
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return client
  } catch (error) {
    if (error instanceof OAuthError) {
      setResponseStatus(event, error.status)
      setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
      return { error: error.code, error_description: error.description }
    }
    throw error
  }
})
