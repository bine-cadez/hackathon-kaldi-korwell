import { createError } from 'h3'
import type { DocDatabase } from './env.ts'
import {
  isMissingSchemaError,
  reactionsFor,
  slackArchiveReady,
  type ReactionView,
  type SlackFileMeta
} from './slack-store.ts'
import {
  buildSlackFtsMatch,
  isSlackChannelId,
  isSlackUserId,
  parseSlackDateRange,
  slackTsToIso,
  type SlackLink
} from './slack-text.ts'

const QUERY_MAX = 2000
const FILTER_MAX = 200

export interface SlackParentSnippet {
  ts: string
  text: string
  userDisplayName: string
  userRealName: string
  deleted: boolean
}

export interface SlackSearchHit {
  channelId: string
  channelName: string
  ts: string
  sentAt: string | null
  userId: string | null
  userDisplayName: string
  userRealName: string
  text: string
  threadTs: string | null
  replyCount: number | null
  editedAt: string | null
  deleted: boolean
  deletedAt: string | null
  subtype: string | null
  isBot: boolean
  botId: string | null
  mentions: string[]
  links: SlackLink[]
  files: SlackFileMeta[]
  reactions: ReactionView[]
  permalink: string | null
  parent: SlackParentSnippet | null
}

export interface SlackSearchQuery {
  query?: string
  channel?: string
  user?: string
  from?: string
  to?: string
  limit?: number
}

interface SearchRow {
  channel_id: string
  ts: string
  channel_name: string
  user_id: string | null
  user_display_name: string
  user_real_name: string
  thread_ts: string | null
  reply_count: number | null
  text: string
  edited_at: string | null
  deleted: number
  deleted_at: string | null
  subtype: string | null
  is_bot: number
  bot_id: string | null
  mentions: string
  links: string
  files: string
  permalink: string | null
  deleted?: number
}

const SELECT_LIST = `m.channel_id, m.ts, m.channel_name, m.user_id, m.user_display_name, m.user_real_name,
  m.thread_ts, m.reply_count, m.text, m.edited_at, m.deleted, m.deleted_at, m.subtype, m.is_bot, m.bot_id,
  m.mentions, m.links, m.files, m.permalink`

export async function searchSlackMessages (
  db: DocDatabase,
  input: SlackSearchQuery
): Promise<{ configured: false } | { configured: true, matches: SlackSearchHit[] }> {
  let ready = false
  try {
    ready = await slackArchiveReady(db)
  } catch (error) {
    if (isMissingSchemaError(error)) return { configured: false }
    throw error
  }
  if (!ready) return { configured: false }

  const query = (input.query ?? '').trim()
  const channel = (input.channel ?? '').trim()
  const user = (input.user ?? '').trim()
  if (query.length > QUERY_MAX) badRequest(`Query must be ${QUERY_MAX} characters or fewer`)
  if (channel.length > FILTER_MAX) badRequest(`Channel filter must be ${FILTER_MAX} characters or fewer`)
  if (user.length > FILTER_MAX) badRequest(`User filter must be ${FILTER_MAX} characters or fewer`)
  const range = parseSlackDateRange(input.from, input.to)
  const channelId = channel && isSlackChannelId(channel) ? channel : null
  const userId = user && isSlackUserId(user) ? user : null
  const match = buildSlackFtsMatch(query, {
    userName: user && !userId ? user : undefined,
    channelName: channel && !channelId ? channel : undefined
  })
  const hasDate = range.from != null || range.toExclusive != null
  if (!match && !channelId && !userId && !hasDate) badRequest('Query is required')

  const filters: string[] = []
  const params: Array<string | number> = []
  if (match) {
    filters.push('slack_messages_fts MATCH ?')
    params.push(match)
  }
  if (channelId) {
    filters.push('m.channel_id = ?')
    params.push(channelId)
  }
  if (userId) {
    filters.push('m.user_id = ?')
    params.push(userId)
  }
  if (range.from != null) {
    filters.push('CAST(m.ts AS REAL) >= ?')
    params.push(range.from)
  }
  if (range.toExclusive != null) {
    filters.push('CAST(m.ts AS REAL) < ?')
    params.push(range.toExclusive)
  }
  const limit = clampLimit(input.limit)
  const where = filters.length ? filters.join(' AND ') : '1 = 1'
  const sql = match
    ? `SELECT ${SELECT_LIST}
       FROM slack_messages AS m
       JOIN slack_messages_fts ON slack_messages_fts.channel_id = m.channel_id AND slack_messages_fts.ts = m.ts
       WHERE ${where}
       ORDER BY bm25(slack_messages_fts), CAST(m.ts AS REAL) DESC
       LIMIT ?`
    : `SELECT ${SELECT_LIST}
       FROM slack_messages AS m
       WHERE ${where}
       ORDER BY CAST(m.ts AS REAL) DESC
       LIMIT ?`

  let rows: SearchRow[]
  try {
    const selected = await db.prepare(sql).bind(...params, limit).all<SearchRow>()
    rows = selected.results
  } catch (error) {
    if (isMissingSchemaError(error)) return { configured: false }
    throw error
  }

  const reactionMap = await reactionsFor(db, rows.map(row => ({ channelId: row.channel_id, ts: row.ts })))
  const parents = await loadParents(db, rows)
  return {
    configured: true,
    matches: rows.map((row) => {
      const parentKey = row.thread_ts && row.thread_ts !== row.ts ? `${row.channel_id}:${row.thread_ts}` : ''
      return {
        channelId: row.channel_id,
        channelName: row.channel_name,
        ts: row.ts,
        sentAt: slackTsToIso(row.ts),
        userId: row.user_id,
        userDisplayName: row.user_display_name,
        userRealName: row.user_real_name,
        text: row.text,
        threadTs: row.thread_ts,
        replyCount: row.reply_count,
        editedAt: row.edited_at,
        deleted: row.deleted === 1,
        deletedAt: row.deleted_at ?? null,
        subtype: row.subtype,
        isBot: row.is_bot === 1,
        botId: row.bot_id,
        mentions: parseJson(row.mentions, []),
        links: parseJson(row.links, []),
        files: parseJson(row.files, []),
        reactions: reactionMap.get(`${row.channel_id}:${row.ts}`) ?? [],
        permalink: row.permalink,
        parent: parentKey ? parents.get(parentKey) ?? null : null
      }
    })
  }
}

async function loadParents (db: DocDatabase, rows: SearchRow[]): Promise<Map<string, SlackParentSnippet>> {
  const wanted = rows.flatMap((row) => {
    if (!row.thread_ts || row.thread_ts === row.ts) return []
    return [{ channelId: row.channel_id, ts: row.thread_ts }]
  })
  const unique = new Map<string, { channelId: string, ts: string }>()
  for (const key of wanted) unique.set(`${key.channelId}:${key.ts}`, key)
  const keys = [...unique.values()]
  const parents = new Map<string, SlackParentSnippet>()
  if (keys.length === 0) return parents
  const clauses = keys.map(() => '(channel_id = ? AND ts = ?)').join(' OR ')
  const params = keys.flatMap(key => [key.channelId, key.ts])
  const { results } = await db.prepare(
    `SELECT channel_id, ts, text, user_display_name, user_real_name, deleted
     FROM slack_messages WHERE ${clauses}`
  ).bind(...params).all<{
    channel_id: string
    ts: string
    text: string
    user_display_name: string
    user_real_name: string
    deleted: number
  }>()
  for (const row of results) {
    parents.set(`${row.channel_id}:${row.ts}`, {
      ts: row.ts,
      text: row.text,
      userDisplayName: row.user_display_name,
      userRealName: row.user_real_name,
      deleted: row.deleted === 1
    })
  }
  return parents
}

function clampLimit (value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 20
  return Math.min(50, Math.max(1, Math.trunc(value)))
}

function badRequest (message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

function parseJson<T> (value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}
