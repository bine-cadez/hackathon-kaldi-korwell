// h3's getRequestURL uses the Node host header, which is localhost inside the
// test adapter. On the Worker the public URL is the incoming request URL.
// Prefer that, then the same Cloudflare URL the Access gate already trusts.
export function publicRequestURL (event: {
  path?: string
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
  web?: { url?: URL }
  context?: {
    cloudflare?: {
      url?: URL | string
      request?: { url?: string }
    }
  }
}): URL {
  const path = event.path || '/'
  return new URL(path, `${publicOrigin(event)}/`)
}

function publicOrigin (event: {
  node?: { req?: { headers?: Record<string, string | string[] | undefined> } }
  web?: { url?: URL }
  context?: {
    cloudflare?: {
      url?: URL | string
      request?: { url?: string }
    }
  }
}): string {
  const cloudflare = event.context?.cloudflare
  const fromBinding = originOf(cloudflare?.url) || originOf(cloudflare?.request?.url)
  if (fromBinding && !isLocalOrigin(fromBinding)) return fromBinding
  if (event.web?.url instanceof URL && !isLocalOrigin(event.web.url.origin)) return event.web.url.origin

  // Local dev and the h3 test adapter report localhost. A tunnel can still
  // pass the public host. Ignore this header when the request URL is already public,
  // so a client cannot pick the token issuer.
  const headers = event.node?.req?.headers
  const forwardedHost = header(headers, 'x-forwarded-host').split(',')[0]?.trim()
  if (forwardedHost && !isLocalHost(forwardedHost)) {
    const proto = header(headers, 'x-forwarded-proto').split(',')[0]?.trim() || 'https'
    return `${proto}://${forwardedHost}`
  }

  if (fromBinding) return fromBinding
  if (event.web?.url instanceof URL) return event.web.url.origin
  return 'http://localhost'
}

function isLocalOrigin (origin: string): boolean {
  try {
    return isLocalHost(new URL(origin).host)
  } catch {
    return false
  }
}

function isLocalHost (host: string): boolean {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return name === 'localhost' || name === '127.0.0.1' || name === '::1'
}

function originOf (value: URL | string | undefined): string {
  if (value instanceof URL) return value.origin
  if (typeof value !== 'string' || !value) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function header (headers: Record<string, string | string[] | undefined> | undefined, name: string): string {
  if (!headers) return ''
  const raw = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(raw)) return raw[0] || ''
  return raw || ''
}
