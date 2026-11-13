import { createError } from 'h3'

const TOKEN = /\p{L}[\p{L}\p{M}\p{N}]*/gu
const MAX_FTS_TOKENS = 32
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
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

export function ftsTokens (value: string): string[] {
  return (value.normalize('NFC').match(TOKEN) ?? []).slice(0, MAX_FTS_TOKENS)
}

export function quoteFtsToken (token: string): string {
  return `"${token.replaceAll('"', '""')}"`
}

function renderClause (text: string, column?: string): string | null {
  const tokens = ftsTokens(text)
  if (tokens.length === 0) return null
  const term = (token: string) => {
    const quoted = quoteFtsToken(token)
    return column ? `${column} : ${quoted}` : quoted
  }
  if (tokens.length === 1) return term(tokens[0] ?? '')
  const all = tokens.map(term).join(' ')
  const phrase = term(tokens.join(' '))
  return `((${all}) OR (${phrase}))`
}

// Quoted tokens only. User text is never concatenated into the MATCH expression raw.
export function buildSlackFtsMatch (query: string, options?: { userName?: string, channelName?: string }): string | null {
  const parts = [
    renderClause(query),
    options?.userName ? renderClause(options.userName, 'user_name') : null,
    options?.channelName ? renderClause(options.channelName, 'channel_name') : null
  ].filter((part): part is string => Boolean(part))
  if (parts.length === 0) return null
  return parts.join(' AND ')
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

function badRequest (message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

function isCalendarDate (value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

function utcMidnightSeconds (value: string): number {
  const match = ISO_DATE.exec(value)
  if (!match) return Number.NaN
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000
}

// Inclusive UTC dates on the Slack message ts. `to` covers that whole UTC day.
// Same window as the document date filter on the metadata-search branch.
export function parseSlackDateRange (from?: string | null, to?: string | null): SlackDateRange {
  const start = (from ?? '').trim()
  const end = (to ?? '').trim()
  if (start && !isCalendarDate(start)) badRequest('from must be a calendar date (YYYY-MM-DD)')
  if (end && !isCalendarDate(end)) badRequest('to must be a calendar date (YYYY-MM-DD)')
  if (start && end && start > end) badRequest('from must be on or before to')
  const fromSeconds = start ? utcMidnightSeconds(start) : null
  const toExclusive = end ? utcMidnightSeconds(end) + 86_400 : null
  return { from: fromSeconds, toExclusive }
}
