export interface SlackUserInfo {
  displayName: string
  realName: string
}

export interface SlackHistoryMessage {
  [key: string]: unknown
}

export interface SlackHistoryPage {
  messages: SlackHistoryMessage[]
  nextCursor: string | null
}

export interface SlackWebClient {
  authTest (): Promise<{ teamId: string | null }>
  usersInfo (userId: string): Promise<SlackUserInfo | null>
  conversationsInfo (channelId: string): Promise<{ name: string } | null>
  getPermalink (channelId: string, messageTs: string): Promise<string | null>
  conversationsHistory (channelId: string, cursor?: string): Promise<SlackHistoryPage>
  conversationsReplies (channelId: string, ts: string, cursor?: string): Promise<SlackHistoryPage>
}

export class SlackApiError extends Error {
  code: string

  constructor (code: string) {
    super(`Slack API ${code}`)
    this.name = 'SlackApiError'
    this.code = code
  }
}

// The caller asked not to sleep through Retry-After (it would run past the backfill deadline).
export class SlackRateLimitPause extends Error {
  retryAfterMs: number

  constructor (retryAfterMs: number) {
    super('slack_rate_limited')
    this.name = 'SlackRateLimitPause'
    this.retryAfterMs = retryAfterMs
  }
}

const HISTORY_LIMIT = '200'
const MAX_ATTEMPTS = 6

export function createSlackWebClient (token: string, options?: {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  // Return false to stop instead of sleeping. Backfill uses this so a Retry-After
  // that would pass the deadline becomes a resume cursor.
  allowWait?: (retryAfterMs: number) => boolean
}): SlackWebClient {
  const fetchImpl = options?.fetch ?? fetch
  const sleep = options?.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)))
  const trimmed = token.trim()

  async function waitForRetry (header: string | null) {
    const delay = retryDelayMs(header)
    if (options?.allowWait && !options.allowWait(delay)) throw new SlackRateLimitPause(delay)
    await sleep(delay)
  }

  async function call (method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    if (!trimmed) throw new SlackApiError('not_configured')
    const url = new URL(`https://slack.com/api/${method}`)
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value)
    }
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const response = await fetchImpl(url, {
        headers: { authorization: `Bearer ${trimmed}` }
      })
      if (response.status === 429) {
        await waitForRetry(response.headers.get('retry-after'))
        continue
      }
      const payload = await response.json() as Record<string, unknown>
      if (payload.ok === false && payload.error === 'ratelimited' && attempt < MAX_ATTEMPTS - 1) {
        await waitForRetry(response.headers.get('retry-after'))
        continue
      }
      return payload
    }
    throw new SlackApiError('ratelimited')
  }

  return {
    async authTest () {
      const payload = await call('auth.test', {})
      if (payload.ok !== true) return { teamId: null }
      return { teamId: typeof payload.team_id === 'string' ? payload.team_id : null }
    },
    async usersInfo (userId) {
      const payload = await call('users.info', { user: userId })
      if (payload.ok !== true) return null
      const user = record(payload.user)
      if (!user) return null
      const profile = record(user.profile)
      const realName = text(user.real_name) || text(profile?.real_name) || text(user.name)
      const displayName = text(profile?.display_name) || text(profile?.display_name_normalized) || realName
      return { displayName, realName }
    },
    async conversationsInfo (channelId) {
      const payload = await call('conversations.info', { channel: channelId })
      if (payload.ok !== true) return null
      const channel = record(payload.channel)
      const name = text(channel?.name)
      if (!name) return null
      return { name }
    },
    async getPermalink (channelId, messageTs) {
      const payload = await call('chat.getPermalink', { channel: channelId, message_ts: messageTs })
      if (payload.ok !== true) return null
      return text(payload.permalink) || null
    },
    async conversationsHistory (channelId, cursor) {
      const payload = await call('conversations.history', {
        channel: channelId,
        limit: HISTORY_LIMIT,
        cursor: cursor ?? ''
      })
      if (payload.ok !== true) throw new SlackApiError(text(payload.error) || 'history_failed')
      return page(payload)
    },
    async conversationsReplies (channelId, ts, cursor) {
      const payload = await call('conversations.replies', {
        channel: channelId,
        ts,
        limit: HISTORY_LIMIT,
        cursor: cursor ?? '',
        inclusive: 'true'
      })
      if (payload.ok !== true) throw new SlackApiError(text(payload.error) || 'replies_failed')
      return page(payload)
    }
  }
}

function page (payload: Record<string, unknown>): SlackHistoryPage {
  const messages = Array.isArray(payload.messages) ? payload.messages.filter(isRecord) : []
  const metadata = record(payload.response_metadata)
  const next = text(metadata?.next_cursor)
  return { messages, nextCursor: next || null }
}

function retryDelayMs (header: string | null): number {
  const seconds = Number(header ?? '1')
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 1
  return Math.min(safe, 30) * 1000
}

function record (value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function isRecord (value: unknown): value is SlackHistoryMessage {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function text (value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
