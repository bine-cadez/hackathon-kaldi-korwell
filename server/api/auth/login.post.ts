import {
  createError,
  defineEventHandler,
  getHeader,
  readBody,
  sendRedirect,
  setCookie,
  setHeader,
  setResponseStatus
} from 'h3'
import {
  loginFormHtml,
  requestIsSecure,
  secretsMatch,
  SITE_AUTH_COOKIE,
  sitePasswordFromEvent,
  siteSessionToken
} from '../../utils/site-password.ts'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export default defineEventHandler(async (event) => {
  const sitePassword = sitePasswordFromEvent(event)
  const contentType = getHeader(event, 'content-type') || ''
  const formPost = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')
  const password = passwordFromBody(await readBody(event))

  if (!sitePassword) {
    if (formPost) return sendRedirect(event, '/', 303)
    return { ok: true, locked: false }
  }

  const matches = await secretsMatch(password, sitePassword)
  if (!matches) {
    if (formPost) {
      setResponseStatus(event, 401, 'Unauthorized')
      setHeader(event, 'cache-control', 'no-store')
      return loginFormHtml(true)
    }
    throw createError({
      statusCode: 401,
      statusMessage: 'Unauthorized',
      data: { message: 'Wrong site password.' }
    })
  }

  setCookie(event, SITE_AUTH_COOKIE, await siteSessionToken(sitePassword), {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestIsSecure(event),
    path: '/',
    maxAge: COOKIE_MAX_AGE
  })

  if (formPost) return sendRedirect(event, '/', 303)
  return { ok: true }
})

function passwordFromBody (body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const value = (body as { password?: unknown }).password
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0].trim()
  return ''
}
