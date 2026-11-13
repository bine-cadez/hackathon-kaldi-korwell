import { defineEventHandler, getCookie, getHeader, readBody, setCookie, setHeader, setResponseStatus } from 'h3'
import { publicRequestURL } from '../utils/mcp-request.ts'
import { accessConfig, type AccessUser } from '../utils/cloudflare-access.ts'
import { handleAuthorize } from '../utils/mcp-authorize.ts'
import { mcpSigningKeyFromEvent } from '../utils/mcp-auth.ts'
import { requestIsSecure, SITE_AUTH_COOKIE, sitePasswordFromEvent } from '../utils/site-password.ts'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export default defineEventHandler(async (event) => {
  const accessUser = event.context.korwellAccessUser as AccessUser | undefined
  const result = await handleAuthorize({
    method: event.method.toUpperCase(),
    url: publicRequestURL(event),
    accessMode: accessConfig(event).mode,
    accessUser: accessUser ?? null,
    sitePassword: sitePasswordFromEvent(event),
    sessionCookie: getCookie(event, SITE_AUTH_COOKIE) ?? null,
    signingKey: mcpSigningKeyFromEvent(event),
    form: event.method.toUpperCase() === 'POST' ? await readBody(event) : null,
    dev: import.meta.dev,
    originHeader: getHeader(event, 'origin') ?? null,
    fetchSite: getHeader(event, 'sec-fetch-site') ?? null
  })
  if (result.sessionCookie) {
    setCookie(event, SITE_AUTH_COOKIE, result.sessionCookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: requestIsSecure(event),
      path: '/',
      maxAge: COOKIE_MAX_AGE
    })
  }
  setResponseStatus(event, result.status)
  for (const [name, value] of Object.entries(result.headers)) setHeader(event, name, value)
  return result.body
})
