import { createError, defineEventHandler, setResponseHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { accessConfig } from '../utils/cloudflare-access.ts'
import { authorizationServerMetadata, protectedResourceMetadata } from '../utils/mcp-auth.ts'
import { publicRequestURL } from '../utils/mcp-request.ts'
import { isOAuthDiscoveryPath } from '../utils/mcp-routes.ts'

// Served from middleware so the `.well-known` paths are not dropped as dotfiles.
export default defineEventHandler((event) => {
  const url = publicRequestURL(event)
  if (!isOAuthDiscoveryPath(url.pathname)) return

  // Do not advertise an authorization server that will refuse every request.
  if (accessConfig(event).mode === 'misconfigured') {
    throw createError({ statusCode: 503, statusMessage: 'Cloudflare Access is not configured' })
  }

  const method = event.method.toUpperCase()
  setResponseHeaders(event, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, accept',
    'cache-control': 'public, max-age=300',
    'x-robots-tag': 'noindex, nofollow'
  })
  if (method === 'OPTIONS') {
    setResponseStatus(event, 204)
    return null
  }
  if (method !== 'GET' && method !== 'HEAD') {
    setResponseStatus(event, 405)
    setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
    return { error: 'method_not_allowed' }
  }

  const path = url.pathname.replace(/\/$/, '') || '/'
  const body = path.endsWith('/oauth-authorization-server')
    ? authorizationServerMetadata(url.origin)
    : protectedResourceMetadata(url.origin)
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  if (method === 'HEAD') return null
  return body
})
