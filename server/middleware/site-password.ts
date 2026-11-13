import { createError, defineEventHandler, getCookie, getHeader, getRequestURL, setHeader, setResponseStatus } from 'h3'
import { accessConfig, verifyAccessUser } from '../utils/cloudflare-access.ts'
import {
  decideSiteAccess,
  isPublicRoute,
  isSlackEventsRoute,
  loginFormHtml,
  normalizePathname,
  SITE_AUTH_COOKIE,
  sitePasswordFromEvent
} from '../utils/site-password.ts'

// Runs before route handlers so a locked upload or search never calls OpenRouter.
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event)
  const pathname = normalizePathname(url.pathname)
  const method = event.method.toUpperCase()
  // Slack cannot present a Cloudflare Access JWT or the site password.
  // Signature verification on this route is the lock. Every other path stays gated,
  // including /api/slack/search and /api/slack/backfill.
  if (isSlackEventsRoute(method, pathname)) return
  const access = accessConfig(event)

  if (access.mode !== 'disabled') {
    const readOnly = method === 'GET' || method === 'HEAD'
    if (readOnly && isPublicRoute(method, pathname)) return
    setHeader(event, 'cache-control', 'private, no-store')

    if (access.mode === 'misconfigured') {
      throw createError({ statusCode: 503, statusMessage: 'Cloudflare Access is not configured' })
    }

    const assertion = getHeader(event, 'cf-access-jwt-assertion')
    const user = assertion ? await verifyAccessUser(assertion, access) : null
    if (!user) throw createError({ statusCode: 401, statusMessage: 'Sign in with your Kaldi email through Cloudflare Access' })

    const origin = getHeader(event, 'origin')
    const requestOrigin = event.context.cloudflare?.url?.origin ?? event.web?.url?.origin ?? url.origin
    if (!readOnly && ((origin && origin !== requestOrigin) || getHeader(event, 'sec-fetch-site') === 'cross-site')) {
      throw createError({ statusCode: 403, statusMessage: 'Cross-origin request denied' })
    }
    if (pathname === '/api/auth/login') throw createError({ statusCode: 404 })

    event.context.korwellAccessUser = user
    return
  }

  const decision = await decideSiteAccess({
    sitePassword: sitePasswordFromEvent(event),
    method: event.method,
    pathname: url.pathname,
    cookie: getCookie(event, SITE_AUTH_COOKIE) ?? null,
    authorization: getHeader(event, 'authorization') ?? null,
    sitePasswordHeader: getHeader(event, 'x-site-password') ?? null
  })
  if (decision === 'allow') return

  setHeader(event, 'cache-control', 'no-store')
  setHeader(event, 'x-robots-tag', 'noindex, nofollow')
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
