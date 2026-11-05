import { createError, defineEventHandler, getCookie, getHeader, getRequestURL, setHeader, setResponseStatus } from 'h3'
import {
  decideSiteAccess,
  loginFormHtml,
  normalizePathname,
  SITE_AUTH_COOKIE,
  sitePasswordFromEvent
} from '../utils/site-password.ts'

// Runs before route handlers so a locked upload or search never calls OpenRouter.
export default defineEventHandler(async (event) => {
  const sitePassword = sitePasswordFromEvent(event)
  const url = getRequestURL(event)
  const decision = await decideSiteAccess({
    sitePassword,
    method: event.method,
    pathname: url.pathname,
    cookie: getCookie(event, SITE_AUTH_COOKIE) ?? null,
    authorization: getHeader(event, 'authorization') ?? null,
    sitePasswordHeader: getHeader(event, 'x-site-password') ?? null
  })
  if (decision === 'allow') return

  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'x-robots-tag', 'noindex, nofollow')
  const pathname = normalizePathname(url.pathname)
  const method = event.method.toUpperCase()
  const pageRequest = (method === 'GET' || method === 'HEAD') && pathname !== '/api' && !pathname.startsWith('/api/')
  if (pageRequest) {
    setResponseStatus(event, 401, 'Unauthorized')
    return loginFormHtml(false)
  }

  throw createError({
    statusCode: 401,
    statusMessage: 'Unauthorized',
    data: {
      message: 'Site password required. Unlock in the browser, or send Authorization: Bearer or the X-Site-Password header.'
    }
  })
})
