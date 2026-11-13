// Who is using Korwell, read from the request during SSR (see
// server/middleware/site-password.ts) and handed to the client in the payload.
// - cloudflare-access: a verified @kaldi.si email
// - password: someone who knows the shared password; no identity
// - open: no lock on this server (local dev)
export type AuthMode = 'cloudflare-access' | 'password' | 'open'

export interface Session {
  auth: AuthMode
  email: string | null
}

export function useSession () {
  return useState<Session>('korwell-session', () => {
    const context = import.meta.server ? useRequestEvent()?.context : undefined
    return {
      auth: context?.korwellAuth ?? 'open',
      email: context?.korwellAccessUser?.email ?? null
    }
  })
}

// Initials in a flame-tinted circle, so they read on the paper background.
export const AVATAR_UI = { root: 'bg-primary/10', fallback: 'font-normal text-primary', icon: 'text-primary' }

// "ana.novak@kaldi.si" → "Ana Novak"
export function displayName (email: string): string {
  const local = email.split('@')[0] ?? email
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(' ') || email
}

// A full page load, so no cached page or query data outlives the session.
export async function signOut () {
  let target = '/'
  try {
    const result = await $fetch<{ redirect?: string }>('/api/auth/logout', { method: 'POST' })
    if (result.redirect?.startsWith('/') && !result.redirect.startsWith('//')) target = result.redirect
  } catch {
    // Already signed out, or the server is down: the home page shows the right lock.
  }
  window.location.assign(target)
}
