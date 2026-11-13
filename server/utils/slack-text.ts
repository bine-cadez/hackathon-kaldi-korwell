import { buildStemmedFtsMatch } from './fts.ts'
import { parseUtcDateRange, utcMidnightSeconds } from './date-range.ts'

const USER_MENTION = /<@([A-Z0-9]+)(?:\|[^>]+)?>/g
const SPECIAL_MENTION = /<!((?:channel|here|everyone)|subteam\^[A-Z0-9]+)(?:\|[^>]+)?>/g
const SLACK_LINK = /<(https?:\/\/[^|>\s]+)(?:\|([^>]+))?>/g

export interface SlackLink {
  url: string
  label: string | null
}

export interface SlackDateRange {
  from: number | null
  toExclusive: number | null
}

// Quoted tokens only. User text is never concatenated into the MATCH expression raw.
// Query words ignore word endings. `all` needs every word, `any` needs one.
export function buildSlackFtsMatch (
  query: string,
  options?: { userName?: string, channelName?: string, mode?: 'all' | 'any' }
): string | null {
  return buildStemmedFtsMatch(query, options?.mode ?? 'all', [
    ...(options?.userName ? [{ column: 'user_name', text: options.userName }] : []),
    ...(options?.channelName ? [{ column: 'channel_name', text: options.channelName }] : [])
  ])
}

export function isSlackChannelId (value: string): boolean {
  return /^[CG][A-Z0-9_]+$/.test(value)
}

export function isSlackUserId (value: string): boolean {
  return /^[UW][A-Z0-9_]+$/.test(value)
}

export function parseSlackText (text: string): { mentions: string[], links: SlackLink[] } {
  const mentions = new Set<string>()
  for (const match of text.matchAll(USER_MENTION)) {
    if (match[1]) mentions.add(match[1])
  }
  for (const match of text.matchAll(SPECIAL_MENTION)) {
    if (match[1]) mentions.add(match[1])
  }
  const links: SlackLink[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(SLACK_LINK)) {
    const url = match[1]
    if (!url || seen.has(url)) continue
    seen.add(url)
    links.push({ url, label: match[2] ?? null })
  }
  return { mentions: [...mentions], links }
}

export function slackPermalink (channelId: string, ts: string, threadTs?: string | null): string {
  const base = `https://slack.com/archives/${encodeURIComponent(channelId)}/p${ts.replace('.', '')}`
  if (threadTs && threadTs !== ts) {
    return `${base}?thread_ts=${encodeURIComponent(threadTs)}&cid=${encodeURIComponent(channelId)}`
  }
  return base
}

export function slackTsToIso (ts: string | null | undefined): string | null {
  if (!ts) return null
  const seconds = Number(ts)
  if (!Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

// Inclusive UTC dates on the Slack message ts. `to` covers that whole UTC day.
// Same window as the document date filter on the metadata-search branch.
export function parseSlackDateRange (from?: string | null, to?: string | null): SlackDateRange {
  const range = parseUtcDateRange(from, to)
  return {
    from: range.from ? utcMidnightSeconds(range.from) : null,
    toExclusive: range.toExclusive ? utcMidnightSeconds(range.toExclusive) : null
  }
}
