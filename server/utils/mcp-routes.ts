function normalizePathname (pathname: string): string {
  const path = pathname.split('?')[0]?.split('#')[0] || '/'
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1)
  return path || '/'
}

const DISCOVERY_PATHS = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server'
])

// Paths Claude and ChatGPT call from their own servers. They never complete
// the browser Access login, so the site gate must not run here. Each handler
// still requires an OAuth bearer token, except discovery metadata.
export function isMcpMachineRoute (method: string, pathname: string): boolean {
  const verb = method.toUpperCase()
  const path = normalizePathname(pathname)
  if (path === '/mcp') return verb === 'POST' || verb === 'GET' || verb === 'DELETE' || verb === 'OPTIONS' || verb === 'HEAD'
  if (path === '/token' || path === '/register') return verb === 'POST' || verb === 'OPTIONS'
  if (DISCOVERY_PATHS.has(path)) return verb === 'GET' || verb === 'HEAD' || verb === 'OPTIONS'
  return false
}

export function isOAuthDiscoveryPath (pathname: string): boolean {
  return DISCOVERY_PATHS.has(normalizePathname(pathname))
}
