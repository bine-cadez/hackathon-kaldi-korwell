export const SITE_AUTH_COOKIE = 'site_auth'

const SESSION_PREFIX = 'site-auth:v1:'

export interface SiteAccessRequest {
  sitePassword: string | undefined | null
  method: string
  pathname: string
  cookie: string | null
  authorization: string | null
  sitePasswordHeader: string | null
}

export type SiteAccessDecision = 'allow' | 'unauthorized'

export function normalizeSitePassword (value: string | undefined | null): string {
  return (value ?? '').trim()
}

export function sitePasswordFromSources (binding: string | undefined, fromProcess: string | undefined): string {
  const fromBinding = normalizeSitePassword(binding)
  if (fromBinding) return fromBinding
  return normalizeSitePassword(fromProcess)
}

export function sitePasswordFromEvent (event: { context?: { cloudflare?: { env?: { SITE_PASSWORD?: string } } } }): string {
  return sitePasswordFromSources(
    event.context?.cloudflare?.env?.SITE_PASSWORD,
    process.env.SITE_PASSWORD
  )
}

export function normalizePathname (pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] || '/'
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path || '/'
}

export function isPublicRoute (method: string, pathname: string): boolean {
  const verb = method.toUpperCase()
  const path = normalizePathname(pathname)
  if ((verb === 'GET' || verb === 'HEAD') && (path === '/api/health' || path === '/favicon.ico' || path === '/korwell-eye.svg' || path === '/robots.txt')) {
    return true
  }
  return verb === 'POST' && path === '/api/auth/login'
}

export function isSlackEventsRoute (method: string, pathname: string): boolean {
  return method.toUpperCase() === 'POST' && normalizePathname(pathname) === '/api/slack/events'
}

export function passwordFromAuthorization (authorization: string | null | undefined): string {
  if (!authorization) return ''
  const match = /^\s*Bearer\s+(\S.*?)\s*$/i.exec(authorization)
  return match?.[1]?.trim() ?? ''
}

export async function siteSessionToken (password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(SESSION_PREFIX + normalizeSitePassword(password))
  )
  return toHex(new Uint8Array(digest))
}

export async function secretsMatch (provided: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    sha256(provided),
    sha256(expected)
  ])
  return timingSafeEqualBytes(left, right)
}

export async function decideSiteAccess (input: SiteAccessRequest): Promise<SiteAccessDecision> {
  const sitePassword = normalizeSitePassword(input.sitePassword)
  if (!sitePassword) return 'allow'
  if (isPublicRoute(input.method, input.pathname)) return 'allow'

  const header = (input.sitePasswordHeader || '').trim()
  if (header && await secretsMatch(header, sitePassword)) return 'allow'

  const bearer = passwordFromAuthorization(input.authorization)
  if (bearer && await secretsMatch(bearer, sitePassword)) return 'allow'

  const cookie = (input.cookie || '').trim()
  if (cookie && await secretsMatch(cookie, await siteSessionToken(sitePassword))) return 'allow'

  return 'unauthorized'
}

export function loginFormHtml (error: boolean): string {
  const message = error ? '<p class="err">Wrong password.</p>' : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Unlock document library</title>
  <link rel="icon" type="image/svg+xml" href="/korwell-eye.svg?v=2">
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3efe4; color: #1c1915; font-family: "Segoe UI", "Helvetica Neue", sans-serif; }
    main { width: min(24rem, calc(100% - 2rem)); background: #fffdf8; border: 1px solid #e3d9c6; border-radius: 16px; padding: 1.25rem; }
    h1 { font-family: Georgia, "Iowan Old Style", serif; font-size: 1.8rem; margin: 0 0 0.4rem; }
    p { color: #5e584e; margin: 0 0 1rem; }
    form { display: grid; gap: 0.75rem; }
    label { display: grid; gap: 0.35rem; }
    input { font: inherit; padding: 0.65rem 0.75rem; border: 1px solid #e3d9c6; border-radius: 10px; }
    button { font: inherit; border: 0; border-radius: 999px; padding: 0.55rem 0.95rem; background: #0d5c5c; color: #f7fffc; cursor: pointer; }
    .err { color: #8a341f; margin: 0.75rem 0 0; }
  </style>
</head>
<body>
  <main>
    <h1>Document library</h1>
    <p>Enter the shared password to upload and search.</p>
    <form method="post" action="/api/auth/login">
      <label>
        Password
        <input type="password" name="password" autocomplete="current-password" required autofocus>
      </label>
      <button type="submit">Unlock</button>
    </form>
    ${message}
  </main>
</body>
</html>`
}

interface SecureRequestEvent {
  node?: {
    req?: {
      headers?: Record<string, string | string[] | undefined>
      socket?: { encrypted?: boolean }
      connection?: { encrypted?: boolean }
    }
  }
  web?: { url?: URL }
  context?: {
    cloudflare?: {
      request?: { url?: string }
      url?: URL | string
    }
  }
}

export function requestIsSecure (event: SecureRequestEvent): boolean {
  const headers = event.node?.req?.headers
  const forwarded = headerValue(headers, 'x-forwarded-proto').split(',')[0]?.trim()
  if (forwarded === 'https') return true
  if (event.node?.req?.socket?.encrypted || event.node?.req?.connection?.encrypted) return true
  if (event.web?.url?.protocol === 'https:') return true
  const requestUrl = event.context?.cloudflare?.request?.url
  if (typeof requestUrl === 'string' && requestUrl.startsWith('https:')) return true
  const cloudflareUrl = event.context?.cloudflare?.url
  if (cloudflareUrl instanceof URL) return cloudflareUrl.protocol === 'https:'
  if (typeof cloudflareUrl === 'string' && cloudflareUrl.startsWith('https:')) return true
  const visitor = headerValue(headers, 'cf-visitor')
  return visitor.includes('https')
}

function headerValue (headers: Record<string, string | string[] | undefined> | undefined, name: string): string {
  if (!headers) return ''
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] || ''
  return raw || ''
}

async function sha256 (value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return new Uint8Array(digest)
}

async function timingSafeEqualBytes (left: Uint8Array, right: Uint8Array): Promise<boolean> {
  if (left.byteLength !== right.byteLength) return false
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean
  }
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(left, right)
  const { timingSafeEqual } = await import('node:crypto')
  return timingSafeEqual(left, right)
}

function toHex (bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
