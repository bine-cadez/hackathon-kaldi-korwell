import { jwtVerify, SignJWT } from 'jose'
import { secretsMatch } from './site-password.ts'

export const MCP_SCOPE = 'documents:read'
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30
export const AUTH_CODE_TTL_SECONDS = 120
export const MIN_SIGNING_KEY_LENGTH = 32

const SUPPORTED_SCOPES = new Set([MCP_SCOPE, 'offline_access'])
const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/

export interface McpIdentity {
  id: string
  email: string
}

export interface OAuthAuthorizeParams {
  responseType: string
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  state: string
  resource: string
  scope: string
  responseMode: string
}

export class OAuthError extends Error {
  status: number
  code: string
  description: string

  constructor (status: number, code: string, description: string) {
    super(description)
    this.status = status
    this.code = code
    this.description = description
  }
}

export function mcpSigningKeyFromEvent (event: { context?: { cloudflare?: { env?: { MCP_SIGNING_KEY?: string } } } }): string {
  const fromBinding = event.context?.cloudflare?.env?.MCP_SIGNING_KEY
  return signingKeyFromSources(fromBinding, process.env.MCP_SIGNING_KEY)
}

export function signingKeyFromSources (binding: string | undefined, fromProcess: string | undefined): string {
  const fromBinding = (binding ?? '').trim()
  if (fromBinding) return fromBinding
  return (fromProcess ?? '').trim()
}

export function signingKeyBytes (secret: string): Uint8Array | null {
  if (secret.length < MIN_SIGNING_KEY_LENGTH) return null
  return new TextEncoder().encode(secret)
}

// Why the key cannot be used, or null when it is fine. Never echoes the key.
export function signingKeyProblem (secret: string): string | null {
  if (!secret) return 'MCP_SIGNING_KEY is not set'
  if (secret.length < MIN_SIGNING_KEY_LENGTH) return `MCP_SIGNING_KEY is too short. Use at least ${MIN_SIGNING_KEY_LENGTH} characters`
  return null
}

function assertSigningKey (secret: string): Uint8Array {
  const key = signingKeyBytes(secret)
  if (!key) throw new OAuthError(503, 'server_error', signingKeyProblem(secret) ?? 'MCP_SIGNING_KEY is not set')
  return key
}

export function issuerFor (origin: string): string {
  return origin.replace(/\/$/, '')
}

export function resourceFor (origin: string): string {
  return `${issuerFor(origin)}/mcp`
}

export function protectedResourceMetadata (origin: string) {
  const issuer = issuerFor(origin)
  return {
    resource: resourceFor(origin),
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_SCOPE],
    resource_name: 'Korwell document library'
  }
}

export function authorizationServerMetadata (origin: string) {
  const issuer = issuerFor(origin)
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [MCP_SCOPE, 'offline_access'],
    authorization_response_iss_parameter_supported: true
  }
}

export function wwwAuthenticate (origin: string, error = 'invalid_token', description = 'Authentication required'): string {
  const metadata = `${issuerFor(origin)}/.well-known/oauth-protected-resource/mcp`
  return `Bearer error="${error}", error_description="${description}", resource_metadata="${metadata}", scope="${MCP_SCOPE}"`
}

export function redirectAllowed (value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.username || url.password || url.hash || url.search) return false
  // Hosted clients only on the default port (URL drops an explicit :443 to '').
  if (url.protocol === 'https:' && url.port) return false
  if (url.protocol === 'https:' && (url.hostname === 'claude.ai' || url.hostname === 'claude.com') && url.pathname === '/api/mcp/auth_callback') return true
  if (url.protocol === 'https:' && url.hostname === 'chatgpt.com' && url.pathname === '/connector_platform_oauth_redirect') return true
  if (url.protocol === 'https:' && url.hostname === 'chatgpt.com' && /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(url.pathname)) return true
  // IPv6 [::1] is not allowed: Chrome rejects it as a CSP form-action source,
  // so the browser would block the redirect back to the client.
  const loopback = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (loopback && (url.pathname === '/callback' || url.pathname === '/oauth/callback')) return true
  return false
}

export function redirectIsLoopback (value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

export function clientLabel (redirectUri: string): string {
  try {
    const host = new URL(redirectUri).hostname
    if (host === 'claude.ai' || host === 'claude.com') return 'Claude'
    if (host === 'chatgpt.com') return 'ChatGPT'
    if (host === 'localhost' || host === '127.0.0.1') return 'a local app'
    return host
  } catch {
    return 'this app'
  }
}

function readParam (params: URLSearchParams, name: string, max: number): string {
  const value = (params.get(name) ?? '').trim()
  if (value.length > max) throw new OAuthError(400, 'invalid_request', `${name} is too long`)
  return value
}

export function parseAuthorizeParams (params: URLSearchParams, origin: string): OAuthAuthorizeParams {
  const parsed: OAuthAuthorizeParams = {
    responseType: readParam(params, 'response_type', 32),
    clientId: readParam(params, 'client_id', 512),
    redirectUri: readParam(params, 'redirect_uri', 512),
    codeChallenge: readParam(params, 'code_challenge', 128),
    codeChallengeMethod: readParam(params, 'code_challenge_method', 16),
    state: readParam(params, 'state', 1024),
    resource: readParam(params, 'resource', 512),
    scope: readParam(params, 'scope', 256),
    responseMode: readParam(params, 'response_mode', 32)
  }
  if (!redirectAllowed(parsed.redirectUri)) throw new OAuthError(400, 'invalid_request', 'redirect_uri is not allowed')
  if (parsed.responseType !== 'code') throw new OAuthError(400, 'unsupported_response_type', 'response_type must be code')
  if (!parsed.clientId) throw new OAuthError(400, 'invalid_request', 'client_id is required')
  if (parsed.codeChallengeMethod !== 'S256') throw new OAuthError(400, 'invalid_request', 'code_challenge_method must be S256')
  if (!CHALLENGE_PATTERN.test(parsed.codeChallenge)) throw new OAuthError(400, 'invalid_request', 'code_challenge must be an S256 challenge')
  if (parsed.responseMode && parsed.responseMode !== 'query') throw new OAuthError(400, 'invalid_request', 'response_mode must be query')
  if (parsed.resource && parsed.resource !== resourceFor(origin)) throw new OAuthError(400, 'invalid_target', 'resource must be this server\'s MCP URL')
  assertScope(parsed.scope)
  return parsed
}

function assertScope (scope: string) {
  if (!scope) return
  for (const part of scope.split(/\s+/).filter(Boolean)) {
    if (!SUPPORTED_SCOPES.has(part)) throw new OAuthError(400, 'invalid_scope', `Unknown scope: ${part}`)
  }
}

export function grantedScope (requested: string): string {
  const parts = new Set((requested || MCP_SCOPE).split(/\s+/).filter(part => SUPPORTED_SCOPES.has(part)))
  if (!parts.has(MCP_SCOPE)) parts.add(MCP_SCOPE)
  return [MCP_SCOPE, ...[...parts].filter(part => part !== MCP_SCOPE)].join(' ')
}

export function authorizeErrorRedirect (redirectUri: string, issuer: string, error: string, description: string, state: string): string | null {
  if (!redirectAllowed(redirectUri)) return null
  const url = new URL(redirectUri)
  url.searchParams.set('error', error)
  url.searchParams.set('error_description', description.slice(0, 180))
  url.searchParams.set('iss', issuer)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

export function authorizeSuccessRedirect (redirectUri: string, issuer: string, code: string, state: string): string {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  url.searchParams.set('iss', issuer)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

function nowSeconds (): number {
  return Math.floor(Date.now() / 1000)
}

// expiresAt is an absolute Unix time, so a refresh can never push it later.
async function signToken (secret: string, typ: string, subject: string, issuer: string, audience: string, expiresAt: number, claims: Record<string, string | number>): Promise<string> {
  const key = assertSigningKey(secret)
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(nowSeconds())
    .setExpirationTime(expiresAt)
    .setJti(crypto.randomUUID())
    .sign(key)
}

export async function signAuthCode (secret: string, origin: string, user: McpIdentity, params: OAuthAuthorizeParams): Promise<string> {
  const issuer = issuerFor(origin)
  const resource = resourceFor(origin)
  return signToken(secret, 'mcp-code', user.id, issuer, resource, nowSeconds() + AUTH_CODE_TTL_SECONDS, {
    email: user.email,
    // When the user approved in the browser. Caps the whole refresh chain.
    auth_time: nowSeconds(),
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    scope: grantedScope(params.scope)
  })
}

async function verifyTypedToken (token: string, secret: string, origin: string, typ: string) {
  const key = assertSigningKey(secret)
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: issuerFor(origin),
      audience: resourceFor(origin),
      typ,
      clockTolerance: 60
    })
    return payload
  } catch {
    return null
  }
}

export interface AccessClaims {
  sub: string
  email: string
  scope: string
  clientId: string
}

export async function verifyAccessToken (token: string, secret: string, origin: string): Promise<AccessClaims | null> {
  const payload = await verifyTypedToken(token, secret, origin, 'at+jwt')
  if (!payload) return null
  const scope = typeof payload.scope === 'string' ? payload.scope : ''
  if (!scope.split(/\s+/).includes(MCP_SCOPE)) return null
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  const email = typeof payload.email === 'string' ? payload.email : ''
  const clientId = typeof payload.client_id === 'string' ? payload.client_id : ''
  if (!sub || !email) return null
  return { sub, email, scope, clientId }
}

export async function pkceMatches (verifier: string, challenge: string): Promise<boolean> {
  if (!VERIFIER_PATTERN.test(verifier) || !CHALLENGE_PATTERN.test(challenge)) return false
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const actual = base64Url(new Uint8Array(digest))
  return secretsMatch(actual, challenge)
}

function tokenResponse (accessToken: string, refreshToken: string, scope: string, expiresIn: number) {
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refreshToken,
    scope
  }
}

// The refresh chain ends at auth_time + 30 days no matter how often it is
// refreshed. Access tokens never outlive that cap either.
export function refreshChainEnd (authTime: number): number {
  return authTime + REFRESH_TOKEN_TTL_SECONDS
}

async function issuePair (secret: string, origin: string, user: McpIdentity, clientId: string, scope: string, authTime: number) {
  const issuer = issuerFor(origin)
  const resource = resourceFor(origin)
  const now = nowSeconds()
  const chainEnd = refreshChainEnd(authTime)
  if (chainEnd <= now) throw new OAuthError(400, 'invalid_grant', 'Refresh token is invalid or expired')
  const accessExpires = Math.min(now + ACCESS_TOKEN_TTL_SECONDS, chainEnd)
  const claims = { email: user.email, scope, client_id: clientId }
  const accessToken = await signToken(secret, 'at+jwt', user.id, issuer, resource, accessExpires, claims)
  const refreshToken = await signToken(secret, 'mcp-refresh', user.id, issuer, resource, chainEnd, { ...claims, auth_time: authTime })
  return tokenResponse(accessToken, refreshToken, scope, accessExpires - now)
}

function authTimeOf (payload: { auth_time?: unknown, iat?: unknown }): number | null {
  const value = payload.auth_time
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  // A signed auth_time from the future means something is wrong. Allow clock skew.
  if (value > nowSeconds() + 60) return null
  return value
}

// Records an authorization code's jti so it can be redeemed once.
// consume resolves true the first time and false for every later attempt.
export interface UsedCodeStore {
  consume (jti: string, expiresAt: number): Promise<boolean>
}

export function formValues (body: unknown): URLSearchParams {
  if (typeof body === 'string') return new URLSearchParams(body)
  if (body instanceof URLSearchParams) return body
  const params = new URLSearchParams()
  if (!body || typeof body !== 'object') return params
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value) && typeof value[0] === 'string') params.set(key, value[0])
  }
  return params
}

export async function exchangeToken (secret: string, origin: string, body: unknown, usedCodes: UsedCodeStore | null): Promise<Record<string, unknown>> {
  assertSigningKey(secret)
  const params = formValues(body)
  const grant = readParam(params, 'grant_type', 64)
  const clientId = readParam(params, 'client_id', 512)
  const resource = readParam(params, 'resource', 512)
  if (!clientId) throw new OAuthError(400, 'invalid_request', 'client_id is required')
  if (resource && resource !== resourceFor(origin)) throw new OAuthError(400, 'invalid_target', 'resource must be this server\'s MCP URL')
  if (params.get('client_secret')) throw new OAuthError(401, 'invalid_client', 'This server only supports public clients')

  if (grant === 'authorization_code') {
    const code = readParam(params, 'code', 8192)
    const redirectUri = readParam(params, 'redirect_uri', 512)
    const verifier = readParam(params, 'code_verifier', 128)
    if (!code || !redirectUri || !verifier) throw new OAuthError(400, 'invalid_request', 'code, redirect_uri, and code_verifier are required')
    const payload = await verifyTypedToken(code, secret, origin, 'mcp-code')
    if (!payload) throw new OAuthError(400, 'invalid_grant', 'Authorization code is invalid or expired')
    if (payload.client_id !== clientId || payload.redirect_uri !== redirectUri) {
      throw new OAuthError(400, 'invalid_grant', 'Authorization code does not match this client')
    }
    const challenge = typeof payload.code_challenge === 'string' ? payload.code_challenge : ''
    if (!await pkceMatches(verifier, challenge)) throw new OAuthError(400, 'invalid_grant', 'PKCE verification failed')
    const user = { id: String(payload.sub || ''), email: typeof payload.email === 'string' ? payload.email : '' }
    const scope = typeof payload.scope === 'string' ? payload.scope : MCP_SCOPE
    const authTime = authTimeOf(payload)
    const jti = typeof payload.jti === 'string' ? payload.jti : ''
    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    if (!user.id || !user.email || !authTime || !jti || !exp) throw new OAuthError(400, 'invalid_grant', 'Authorization code is invalid or expired')
    // Single use (OAuth 2.1). Checked after PKCE so someone holding only the
    // code cannot burn it. Without storage, fail closed.
    if (!usedCodes) throw new OAuthError(503, 'server_error', 'Authorization code storage is unavailable')
    if (!await usedCodes.consume(jti, exp)) throw new OAuthError(400, 'invalid_grant', 'Authorization code was already used')
    return issuePair(secret, origin, user, clientId, scope, authTime)
  }

  if (grant === 'refresh_token') {
    const refresh = readParam(params, 'refresh_token', 8192)
    if (!refresh) throw new OAuthError(400, 'invalid_request', 'refresh_token is required')
    const payload = await verifyTypedToken(refresh, secret, origin, 'mcp-refresh')
    if (!payload) throw new OAuthError(400, 'invalid_grant', 'Refresh token is invalid or expired')
    if (payload.client_id !== clientId) throw new OAuthError(400, 'invalid_grant', 'Refresh token does not match this client')
    const user = { id: String(payload.sub || ''), email: typeof payload.email === 'string' ? payload.email : '' }
    const scope = typeof payload.scope === 'string' ? payload.scope : MCP_SCOPE
    const authTime = authTimeOf(payload)
    if (!user.id || !user.email || !authTime || !scope.split(/\s+/).includes(MCP_SCOPE)) {
      throw new OAuthError(400, 'invalid_grant', 'Refresh token is invalid or expired')
    }
    return issuePair(secret, origin, user, clientId, scope, authTime)
  }

  throw new OAuthError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token')
}

export function registerClient (secret: string, body: unknown): Record<string, unknown> {
  assertSigningKey(secret)
  if (!body || typeof body !== 'object') throw new OAuthError(400, 'invalid_client_metadata', 'JSON body is required')
  const record = body as {
    redirect_uris?: unknown
    client_name?: unknown
    grant_types?: unknown
    response_types?: unknown
    token_endpoint_auth_method?: unknown
  }
  if (!Array.isArray(record.redirect_uris) || record.redirect_uris.length === 0 || record.redirect_uris.length > 8) {
    throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uris must list 1 to 8 allowed URLs')
  }
  const redirectUris: string[] = []
  for (const value of record.redirect_uris) {
    if (typeof value !== 'string' || !redirectAllowed(value)) {
      throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uri is not allowed')
    }
    redirectUris.push(value)
  }
  if (record.token_endpoint_auth_method && record.token_endpoint_auth_method !== 'none') {
    throw new OAuthError(400, 'invalid_client_metadata', 'token_endpoint_auth_method must be none')
  }
  const grants = Array.isArray(record.grant_types) ? record.grant_types : ['authorization_code', 'refresh_token']
  if (grants.some(grant => grant !== 'authorization_code' && grant !== 'refresh_token')) {
    throw new OAuthError(400, 'invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported')
  }
  const responses = Array.isArray(record.response_types) ? record.response_types : ['code']
  if (responses.some(response => response !== 'code')) {
    throw new OAuthError(400, 'invalid_client_metadata', 'response_types must be code')
  }
  const name = typeof record.client_name === 'string' ? record.client_name.replace(/[^\w .()-]/g, '').trim().slice(0, 80) : ''
  return {
    client_id: crypto.randomUUID(),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name || 'MCP client',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none'
  }
}

function consentMaterial (userId: string, params: OAuthAuthorizeParams): string {
  return [
    userId,
    params.clientId,
    params.redirectUri,
    params.codeChallenge,
    params.codeChallengeMethod,
    params.state,
    params.resource,
    params.scope,
    params.responseType
  ].join('\n')
}

export async function signConsent (secret: string, userId: string, params: OAuthAuthorizeParams): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 600
  const mac = await hmacHex(secret, `${exp}\n${consentMaterial(userId, params)}`)
  return `${exp}.${mac}`
}

export async function verifyConsent (secret: string, userId: string, params: OAuthAuthorizeParams, token: string): Promise<boolean> {
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = Number(token.slice(0, dot))
  const mac = token.slice(dot + 1)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const expected = await hmacHex(secret, `${exp}\n${consentMaterial(userId, params)}`)
  return secretsMatch(mac, expected)
}

async function hmacHex (secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return toHex(new Uint8Array(signature))
}

function base64Url (bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function toHex (bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}
