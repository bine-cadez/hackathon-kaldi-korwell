import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

interface AccessSettings {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
}

interface AccessConfig {
  issuer: string
  audience: string
}

export interface AccessUser {
  id: string
  email: string
}

export function accessConfig (event: { context?: { cloudflare?: { env?: AccessSettings } } }) {
  const env = event.context?.cloudflare?.env
  const teamDomain = (env?.ACCESS_TEAM_DOMAIN ?? process.env.ACCESS_TEAM_DOMAIN ?? '').trim()
  const audience = (env?.ACCESS_AUD ?? process.env.ACCESS_AUD ?? '').trim()
  if (!teamDomain && !audience) return { mode: 'disabled' } as const

  const host = /^(?:https:\/\/)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com)\/?$/i.exec(teamDomain)?.[1]
  if (!host || !audience || /\s/.test(audience)) return { mode: 'misconfigured' } as const

  return { mode: 'enabled', issuer: `https://${host.toLowerCase()}`, audience } as const
}

const teamKeys = new Map<string, JWTVerifyGetKey>()

function accessKeys (issuer: string): JWTVerifyGetKey {
  const cached = teamKeys.get(issuer)
  if (cached) return cached
  const keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer))
  teamKeys.set(issuer, keys)
  return keys
}

export async function verifyAccessUser (
  token: string,
  config: AccessConfig,
  keys: JWTVerifyGetKey = accessKeys(config.issuer)
): Promise<AccessUser | null> {
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'email']
    })
    const { sub, email } = payload
    if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !/^[^@\s]+@kaldi\.si$/i.test(email)) return null
    return { id: sub, email }
  } catch {
    // A missing key or invalid assertion must never grant access.
    return null
  }
}
