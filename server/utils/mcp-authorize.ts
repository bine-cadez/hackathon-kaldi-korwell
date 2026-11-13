import { secretsMatch, siteSessionToken } from './site-password.ts'
import {
  authorizeErrorRedirect,
  authorizeSuccessRedirect,
  clientLabel,
  formValues,
  issuerFor,
  OAuthError,
  parseAuthorizeParams,
  redirectAllowed,
  redirectIsLoopback,
  signAuthCode,
  signConsent,
  signingKeyProblem,
  verifyConsent,
  type McpIdentity,
  type OAuthAuthorizeParams
} from './mcp-auth.ts'

const FIELD_NAMES = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'state',
  'resource',
  'scope',
  'response_mode'
] as const

export interface AuthorizeInput {
  method: string
  url: URL
  accessMode: 'disabled' | 'enabled' | 'misconfigured'
  accessUser: McpIdentity | null
  sitePassword: string
  sessionCookie: string | null
  signingKey: string
  form: unknown
  dev: boolean
  originHeader: string | null
  fetchSite: string | null
}

export interface AuthorizeResult {
  status: number
  headers: Record<string, string>
  body: string
  sessionCookie?: string
}

export async function handleAuthorize (input: AuthorizeInput): Promise<AuthorizeResult> {
  const keyProblem = signingKeyProblem(input.signingKey)
  if (keyProblem) {
    return html(503, `<p>${escapeHtml(keyProblem)}. Fix the Worker secret before connecting a client.</p>`)
  }
  if (input.accessMode === 'misconfigured') {
    return html(503, '<p>Cloudflare Access is not configured.</p>')
  }
  if (input.method === 'POST' && crossSite(input)) {
    return html(403, '<p>Cross-origin request denied.</p>')
  }

  const form = input.method === 'POST' ? formValues(input.form) : null
  const intent = form?.get('intent') ?? ''

  if (intent === 'unlock') {
    const password = (form?.get('password') ?? '').trim()
    const matches = Boolean(input.sitePassword) && await secretsMatch(password, input.sitePassword)
    if (!matches) return html(401, passwordForm(input.url, 'Wrong password.'))
    const next = new URL('/authorize', input.url.origin)
    copyOAuthFields(form!, next.searchParams)
    return {
      status: 303,
      headers: { location: next.toString(), 'cache-control': 'no-store', 'referrer-policy': REFERRER_POLICY },
      body: '',
      sessionCookie: await siteSessionToken(input.sitePassword)
    }
  }

  const user = await resolveUser(input)
  if (!user) {
    if (input.accessMode === 'enabled') return html(401, '<p>Sign in with your Kaldi email through Cloudflare Access, then retry this connection.</p>')
    if (input.sitePassword) return html(401, passwordForm(input.url, ''))
    return html(503, '<p>MCP sign-in needs Cloudflare Access or SITE_PASSWORD.</p>')
  }

  const params = input.method === 'POST' && form ? form : input.url.searchParams
  let redirectUri = ''
  try {
    redirectUri = (params.get('redirect_uri') ?? '').trim()
  } catch {
    redirectUri = ''
  }

  let parsed: OAuthAuthorizeParams
  try {
    parsed = parseAuthorizeParams(params, input.url.origin)
  } catch (error) {
    if (!(error instanceof OAuthError)) throw error
    const location = redirectAllowed(redirectUri)
      ? authorizeErrorRedirect(redirectUri, issuerFor(input.url.origin), error.code, error.description, (params.get('state') ?? '').trim())
      : null
    if (!location) return html(400, `<p>${escapeHtml(error.description)}</p>`)
    return redirect(location, error.code === 'access_denied' ? 302 : 302)
  }

  if (input.method === 'POST' && intent === 'deny') {
    const location = authorizeErrorRedirect(parsed.redirectUri, issuerFor(input.url.origin), 'access_denied', 'The request was denied', parsed.state)
    return redirect(location || '/', 302)
  }

  if (input.method === 'POST' && intent === 'allow') {
    const csrf = form?.get('csrf') ?? ''
    if (!await verifyConsent(input.signingKey, user.id, parsed, csrf)) {
      return html(400, consentPage(input.url.origin, user, parsed, await signConsent(input.signingKey, user.id, parsed), 'The confirmation expired. Review the connection and try again.'), parsed.redirectUri)
    }
    const code = await signAuthCode(input.signingKey, input.url.origin, user, parsed)
    console.log(JSON.stringify({ message: 'mcp_authorize', email: user.email, client: clientLabel(parsed.redirectUri) }))
    return redirect(authorizeSuccessRedirect(parsed.redirectUri, issuerFor(input.url.origin), code, parsed.state), 302)
  }

  if (input.method !== 'GET' && input.method !== 'HEAD') return html(405, '<p>Method not allowed.</p>')
  return html(200, consentPage(input.url.origin, user, parsed, await signConsent(input.signingKey, user.id, parsed), ''), parsed.redirectUri)
}

async function resolveUser (input: AuthorizeInput): Promise<McpIdentity | null> {
  if (input.accessMode === 'enabled') return input.accessUser
  if (input.sitePassword) {
    const cookie = (input.sessionCookie ?? '').trim()
    if (!cookie) return null
    if (!await secretsMatch(cookie, await siteSessionToken(input.sitePassword))) return null
    return { id: 'site-password', email: 'site-password@local' }
  }
  if (input.dev) return { id: 'local-dev', email: 'dev@localhost' }
  return null
}

// Must send the Origin on same-origin POSTs. With no-referrer, Chrome sends
// `Origin: null` for the Allow/Deny form and the cross-origin check rejects it.
// same-origin still sends nothing to Claude, ChatGPT, or a loopback client.
export const REFERRER_POLICY = 'same-origin'

// Chrome applies form-action to the redirect after a form POST, so the
// consent page must also allow the validated client redirect origin.
export function formActionSources (redirectUri?: string): string {
  const sources = ["'self'"]
  if (redirectUri && redirectAllowed(redirectUri)) {
    const target = new URL(redirectUri).origin
    if (/^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(target)) sources.push(target)
  }
  return sources.join(' ')
}

function crossSite (input: AuthorizeInput): boolean {
  if (input.fetchSite === 'cross-site') return true
  if (!input.originHeader) return false
  return input.originHeader !== input.url.origin
}

function copyOAuthFields (form: URLSearchParams, target: URLSearchParams) {
  for (const name of FIELD_NAMES) {
    const value = form.get(name)
    if (value) target.set(name, value)
  }
}

function hidden (name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`
}

function oauthFields (params: OAuthAuthorizeParams): string {
  return [
    hidden('response_type', params.responseType),
    hidden('client_id', params.clientId),
    hidden('redirect_uri', params.redirectUri),
    hidden('code_challenge', params.codeChallenge),
    hidden('code_challenge_method', params.codeChallengeMethod),
    hidden('state', params.state),
    hidden('resource', params.resource),
    hidden('scope', params.scope),
    hidden('response_mode', params.responseMode)
  ].join('')
}

function passwordForm (url: URL, error: string): string {
  const fields = FIELD_NAMES.map(name => hidden(name, url.searchParams.get(name) ?? '')).join('')
  const message = error ? `<p class="err">${escapeHtml(error)}</p>` : ''
  return page('Unlock document library', `
    <h1>Document library</h1>
    <p>Enter the shared password to connect a client.</p>
    <form method="post" action="/authorize">
      ${fields}
      <label>Password <input type="password" name="password" autocomplete="current-password" required autofocus></label>
      <button type="submit" name="intent" value="unlock">Unlock</button>
    </form>
    ${message}
  `)
}

function consentPage (origin: string, user: McpIdentity, params: OAuthAuthorizeParams, csrf: string, error: string): string {
  const label = clientLabel(params.redirectUri)
  const loopback = redirectIsLoopback(params.redirectUri)
    ? '<p class="err">This redirect is on your computer. Continue only if you started the connection. Any local program can listen on that port.</p>'
    : ''
  const message = error ? `<p class="err">${escapeHtml(error)}</p>` : ''
  return page('Connect Korwell', `
    <h1>Connect ${escapeHtml(label)}</h1>
    <p>${escapeHtml(label)} will be able to search and read Korwell documents as ${escapeHtml(user.email)}. It cannot add, edit, or delete them.</p>
    <p>Redirect host: <strong>${escapeHtml(new URL(params.redirectUri).host)}</strong></p>
    ${loopback}
    ${message}
    <form method="post" action="/authorize">
      ${oauthFields(params)}
      ${hidden('csrf', csrf)}
      <button type="submit" name="intent" value="allow">Allow read access</button>
      <button type="submit" name="intent" value="deny" class="secondary">Deny</button>
    </form>
    <p class="meta">${escapeHtml(issuerFor(origin))}</p>
  `)
}

function page (title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f3efe4; color: #1c1915; font-family: "Segoe UI", "Helvetica Neue", sans-serif; }
    main { width: min(28rem, calc(100% - 2rem)); background: #fffdf8; border: 1px solid #e3d9c6; border-radius: 16px; padding: 1.25rem; }
    h1 { font-family: Georgia, "Iowan Old Style", serif; font-size: 1.8rem; margin: 0 0 0.4rem; }
    p { color: #5e584e; margin: 0 0 1rem; }
    form { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    label { display: grid; gap: 0.35rem; width: 100%; }
    input { font: inherit; padding: 0.65rem 0.75rem; border: 1px solid #e3d9c6; border-radius: 10px; }
    button { font: inherit; border: 0; border-radius: 999px; padding: 0.55rem 0.95rem; background: #0d5c5c; color: #f7fffc; cursor: pointer; }
    button.secondary { background: transparent; color: #1c1915; border: 1px solid #e3d9c6; }
    .err { color: #8a341f; }
    .meta { font-size: 0.85rem; }
    strong { color: #1c1915; }
  </style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`
}

function html (status: number, body: string, redirectUri?: string): AuthorizeResult {
  return {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': REFERRER_POLICY,
      'x-robots-tag': 'noindex, nofollow',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formActionSources(redirectUri)}; base-uri 'none'; frame-ancestors 'none'`
    },
    body: body.startsWith('<!DOCTYPE') ? body : page('Korwell', body)
  }
}

function redirect (location: string, status: number): AuthorizeResult {
  return {
    status,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': REFERRER_POLICY,
      'x-robots-tag': 'noindex, nofollow'
    },
    body: ''
  }
}

function escapeHtml (value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char] || char)
}
