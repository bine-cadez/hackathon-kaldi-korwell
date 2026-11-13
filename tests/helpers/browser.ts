// Models what Chrome sends for an HTML form POST and what it allows after it.
// The old tests hard-coded a same-origin Origin header, which hid the bug
// where `Referrer-Policy: no-referrer` makes Chrome send `Origin: null`.

// Fetch spec, "serializing a request origin", for a no-cors form POST.
export function formPostOrigin (page: Response, pageUrl: string, action: string): string {
  const policy = (page.headers.get('referrer-policy') ?? 'strict-origin-when-cross-origin').split(',').pop()!.trim().toLowerCase()
  const from = new URL(pageUrl)
  const to = new URL(action, pageUrl)
  if (policy === 'no-referrer') return 'null'
  if (policy === 'same-origin' && from.origin !== to.origin) return 'null'
  if ((policy === 'strict-origin' || policy === 'strict-origin-when-cross-origin' || policy === 'no-referrer-when-downgrade') &&
    from.protocol === 'https:' && to.protocol === 'http:' && to.hostname !== 'localhost' && to.hostname !== '127.0.0.1') return 'null'
  return from.origin
}

export function formPostHeaders (page: Response, pageUrl: string, action: string, extra: Record<string, string> = {}): Record<string, string> {
  const from = new URL(pageUrl)
  const to = new URL(action, pageUrl)
  return {
    origin: formPostOrigin(page, pageUrl, action),
    'sec-fetch-site': from.origin === to.origin ? 'same-origin' : 'cross-site',
    'sec-fetch-mode': 'navigate',
    'content-type': 'application/x-www-form-urlencoded',
    ...extra
  }
}

// CSP form-action check, applied by Chrome to the form target and to every
// redirect that follows the submission. Supports 'self' and exact origins.
export function formActionAllows (page: Response, pageUrl: string, target: string): boolean {
  const csp = page.headers.get('content-security-policy') ?? ''
  const directive = csp.split(';').map(part => part.trim()).find(part => part.startsWith('form-action '))
  if (!directive) return true
  const sources = directive.split(/\s+/).slice(1)
  const url = new URL(target, pageUrl)
  for (const source of sources) {
    if (source === "'self'" && url.origin === new URL(pageUrl).origin) return true
    if (source === "'none'") return false
    if (/^https?:\/\//.test(source) && new URL(source).origin === url.origin) return true
  }
  return false
}

export function formFields (html: string): URLSearchParams {
  const fields = new URLSearchParams()
  for (const match of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    fields.set(match[1], match[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
  }
  return fields
}
