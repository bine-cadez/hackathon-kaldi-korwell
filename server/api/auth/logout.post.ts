import { defineEventHandler, deleteCookie, setHeader } from 'h3'
import { accessConfig } from '../../utils/cloudflare-access.ts'
import { requestIsSecure, SITE_AUTH_COOKIE } from '../../utils/site-password.ts'

// POST /api/auth/logout: forget the shared-password session and tell the
// browser where to go next. Behind Cloudflare Access the session lives in
// Access's own cookie, which only its logout URL on this hostname can clear.
export default defineEventHandler((event) => {
  setHeader(event, 'cache-control', 'no-store')
  deleteCookie(event, SITE_AUTH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestIsSecure(event),
    path: '/'
  })
  const redirect = accessConfig(event).mode === 'enabled' ? '/cdn-cgi/access/logout' : '/'
  return { ok: true, redirect }
})
