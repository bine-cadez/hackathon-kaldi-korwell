import type { DocDatabase } from './env.ts'
import { isMissingSchemaError } from './capabilities.ts'
import type { SlackLink } from './slack-text.ts'

const PATCH_COLUMNS = new Set([
  'team_id',
  'channel_name',
  'user_id',
  'user_display_name',
  'user_real_name',
  'thread_ts',
  'reply_count',
  'text',
  'edited_at',
  'edit_history',
  'deleted',
  'deleted_at',
  'subtype',
  'is_bot',
  'bot_id',
  'mentions',
  'links',
  'files',
  'permalink',
  'raw_event',
  'updated_at'
])

export interface EditEntry {
  text: string
  edited_at: string | null
  user_id: string | null
}

export interface SlackFileMeta {
  id: string | null
  name: string | null
  title: string | null
  mimetype: string | null
  filetype: string | null
  size: number | null
  permalink: string | null
}

export interface SlackMessageDraft {
  channelId: string
  ts: string
  teamId: string | null
  channelName: string
  userId: string | null
  userDisplayName: string
  userRealName: string
  threadTs: string | null
  replyCount: number | null
  text: string
  editedAt: string | null
  editHistory: EditEntry[]
  deleted: boolean
  deletedAt: string | null
  subtype: string | null
  isBot: boolean
  botId: string | null
  mentions: string[]
  links: SlackLink[]
  files: SlackFileMeta[]
  permalink: string | null
  rawEvent: unknown
  createdAt: string
  updatedAt: string
}

export interface StoredMessage {
  channel_id: string
  ts: string
  team_id: string | null
  channel_name: string
  user_id: string | null
  user_display_name: string
  user_real_name: string
  thread_ts: string | null
  reply_count: number | null
  text: string
  edited_at: string | null
  edit_history: string
  deleted: number
  deleted_at: string | null
  subtype: string | null
  is_bot: number
  bot_id: string | null
  mentions: string
  links: string
  files: string
  permalink: string | null
  raw_event: string
  created_at: string
  updated_at: string
}

type Patch = Record<string, string | number | null>

export async function slackArchiveReady (db: Pick<DocDatabase, 'prepare'>): Promise<boolean> {
  try {
    const tables = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name IN ('slack_messages', 'slack_messages_fts', 'slack_reactions')`
    ).all<{ name: string }>()
    const names = new Set(tables.results.map(row => row.name))
    return names.has('slack_messages') && names.has('slack_messages_fts') && names.has('slack_reactions')
  } catch (error) {
    if (isMissingSchemaError(error)) return false
    throw error
  }
}

export async function readMessage (db: DocDatabase, channelId: string, ts: string): Promise<StoredMessage | null> {
  return await db.prepare(
    `SELECT channel_id, ts, team_id, channel_name, user_id, user_display_name, user_real_name,
            thread_ts, reply_count, text, edited_at, edit_history, deleted, deleted_at, subtype,
            is_bot, bot_id, mentions, links, files, permalink, raw_event, created_at, updated_at
     FROM slack_messages WHERE channel_id = ? AND ts = ?`
  ).bind(channelId, ts).first<StoredMessage>()
}

export async function storeNewMessage (db: DocDatabase, draft: SlackMessageDraft): Promise<'inserted' | 'filled' | 'unchanged'> {
  const inserted = await insertMessage(db, draft, 'nothing')
  if (inserted > 0) return 'inserted'
  const filled = await fillBlankMessage(db, draft)
  return filled > 0 ? 'filled' : 'unchanged'
}

export async function storeEditedMessage (
  db: DocDatabase,
  draft: SlackMessageDraft,
  previousText: string | null,
  editorId: string | null
): Promise<'inserted' | 'edited' | 'unchanged'> {
  const existing = await readMessage(db, draft.channelId, draft.ts)
  if (!existing) {
    const history = previousText && previousText !== draft.text
      ? [{ text: previousText, edited_at: draft.editedAt, user_id: editorId }]
      : draft.editHistory
    await insertMessage(db, { ...draft, editHistory: history }, 'snapshot')
    return 'inserted'
  }
  if (existing.deleted) return 'unchanged'
  if (existing.edited_at && draft.editedAt && Number(draft.editedAt) < Number(existing.edited_at)) return 'unchanged'
  if (existing.edited_at === draft.editedAt && existing.text === draft.text) return 'unchanged'
  const history = parseHistory(existing.edit_history)
  const prior = previousText ?? existing.text
  if (prior && prior !== draft.text && !history.some(entry => entry.text === prior && entry.edited_at === draft.editedAt)) {
    history.push({ text: prior, edited_at: draft.editedAt, user_id: editorId })
  }
  const patch: Patch = {
    text: draft.text,
    edited_at: draft.editedAt,
    edit_history: JSON.stringify(history.slice(-20)),
    raw_event: JSON.stringify(draft.rawEvent),
    mentions: JSON.stringify(draft.mentions),
    links: JSON.stringify(draft.links),
    subtype: draft.subtype ?? existing.subtype,
    is_bot: draft.isBot ? 1 : existing.is_bot
  }
  if (draft.files.length > 0) patch.files = JSON.stringify(draft.files)
  if (draft.botId) patch.bot_id = draft.botId
  if (draft.replyCount != null) patch.reply_count = draft.replyCount
  if (draft.threadTs) patch.thread_ts = draft.threadTs
  fillBlanks(existing, draft, patch)
  await patchMessage(db, draft.channelId, draft.ts, patch, draft.updatedAt)
  return 'edited'
}

export async function storeDeletedMessage (db: DocDatabase, draft: SlackMessageDraft): Promise<'inserted' | 'deleted' | 'unchanged'> {
  const tombstone = { ...draft, deleted: true }
  const updated = await db.prepare(
    `UPDATE slack_messages
     SET deleted = 1,
         deleted_at = ?,
         text = CASE WHEN text = '' THEN ? ELSE text END,
         updated_at = ?
     WHERE channel_id = ? AND ts = ? AND deleted = 0`
  ).bind(
    tombstone.deletedAt,
    tombstone.text,
    tombstone.updatedAt,
    tombstone.channelId,
    tombstone.ts
  ).run()
  if (statementChanges(updated) > 0) return 'deleted'
  const inserted = await insertMessage(db, tombstone, 'nothing')
  return inserted > 0 ? 'inserted' : 'unchanged'
}

export async function storeSnapshot (db: DocDatabase, draft: SlackMessageDraft): Promise<'inserted' | 'updated' | 'unchanged'> {
  const written = await insertMessage(db, draft, 'snapshot')
  return written > 0 ? 'updated' : 'unchanged'
}

export function messageSnapshotStatement (db: Pick<DocDatabase, 'prepare'>, draft: SlackMessageDraft): D1Statement {
  return db.prepare(
    `INSERT INTO slack_messages (
       channel_id, ts, team_id, channel_name, user_id, user_display_name, user_real_name,
       thread_ts, reply_count, text, edited_at, edit_history, deleted, deleted_at, subtype,
       is_bot, bot_id, mentions, links, files, permalink, raw_event, created_at, updated_at
     ) VALUES (${placeholders(24)})
     ON CONFLICT(channel_id, ts) DO UPDATE SET
       team_id = COALESCE(excluded.team_id, slack_messages.team_id),
       channel_name = CASE WHEN excluded.channel_name != '' THEN excluded.channel_name ELSE slack_messages.channel_name END,
       user_id = COALESCE(excluded.user_id, slack_messages.user_id),
       user_display_name = CASE WHEN excluded.user_display_name != '' THEN excluded.user_display_name ELSE slack_messages.user_display_name END,
       user_real_name = CASE WHEN excluded.user_real_name != '' THEN excluded.user_real_name ELSE slack_messages.user_real_name END,
       thread_ts = COALESCE(excluded.thread_ts, slack_messages.thread_ts),
       reply_count = COALESCE(excluded.reply_count, slack_messages.reply_count),
       text = excluded.text,
       edited_at = COALESCE(excluded.edited_at, slack_messages.edited_at),
       edit_history = CASE WHEN excluded.edit_history != '[]' THEN excluded.edit_history ELSE slack_messages.edit_history END,
       deleted = CASE WHEN excluded.deleted = 1 THEN 1 ELSE slack_messages.deleted END,
       deleted_at = CASE WHEN excluded.deleted = 1 THEN excluded.deleted_at ELSE slack_messages.deleted_at END,
       subtype = COALESCE(excluded.subtype, slack_messages.subtype),
       is_bot = excluded.is_bot,
       bot_id = COALESCE(excluded.bot_id, slack_messages.bot_id),
       mentions = excluded.mentions,
       links = excluded.links,
       files = excluded.files,
       permalink = COALESCE(slack_messages.permalink, excluded.permalink),
       raw_event = excluded.raw_event,
       updated_at = excluded.updated_at
     WHERE slack_messages.deleted = 0
       AND (
         slack_messages.edited_at IS NULL
         OR excluded.edited_at IS NULL
         OR CAST(slack_messages.edited_at AS REAL) <= CAST(excluded.edited_at AS REAL)
       )`
  ).bind(...messageValues(draft))
}

export async function storeReplyCount (db: DocDatabase, channelId: string, ts: string, replyCount: number, updatedAt: string): Promise<void> {
  const existing = await readMessage(db, channelId, ts)
  if (!existing) return
  if (existing.reply_count != null && existing.reply_count >= replyCount) return
  await patchMessage(db, channelId, ts, { reply_count: replyCount }, updatedAt)
}

export async function setReaction (
  db: DocDatabase,
  input: { channelId: string, ts: string, name: string, userId: string, removed: boolean, eventTs: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO slack_reactions (channel_id, ts, name, user_id, removed, event_ts)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (channel_id, ts, name, user_id) DO UPDATE SET
       removed = excluded.removed,
       event_ts = excluded.event_ts
     WHERE slack_reactions.event_ts < excluded.event_ts
        OR (slack_reactions.event_ts = excluded.event_ts AND excluded.removed = 1 AND slack_reactions.removed = 0)`
  ).bind(
    input.channelId,
    input.ts,
    input.name,
    input.userId,
    input.removed ? 1 : 0,
    input.eventTs
  ).run()
}

export async function rememberChannel (db: DocDatabase, channelId: string, teamId: string | null, name: string, updatedAt: string): Promise<void> {
  if (!name) return
  await db.prepare(
    `INSERT INTO slack_channels (channel_id, team_id, name, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (channel_id) DO UPDATE SET
       name = excluded.name,
       team_id = COALESCE(excluded.team_id, slack_channels.team_id),
       updated_at = excluded.updated_at`
  ).bind(channelId, teamId, name, updatedAt).run()
  await db.prepare(
    `UPDATE slack_messages SET channel_name = ?, updated_at = ? WHERE channel_id = ? AND channel_name = ''`
  ).bind(name, updatedAt, channelId).run()
}

export async function renameChannel (db: DocDatabase, channelId: string, teamId: string | null, name: string, updatedAt: string): Promise<void> {
  await rememberChannel(db, channelId, teamId, name, updatedAt)
  await db.prepare(
    `UPDATE slack_messages SET channel_name = ?, updated_at = ? WHERE channel_id = ? AND channel_name != ?`
  ).bind(name, updatedAt, channelId, name).run()
}

export async function rememberUser (
  db: DocDatabase,
  user: { userId: string, teamId: string | null, displayName: string, realName: string, updatedAt: string }
): Promise<void> {
  await db.prepare(
    `INSERT INTO slack_users (user_id, team_id, display_name, real_name, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id) DO UPDATE SET
       display_name = excluded.display_name,
       real_name = excluded.real_name,
       team_id = COALESCE(excluded.team_id, slack_users.team_id),
       updated_at = excluded.updated_at`
  ).bind(user.userId, user.teamId, user.displayName, user.realName, user.updatedAt).run()
  if (!user.displayName && !user.realName) return
  await db.prepare(
    `UPDATE slack_messages
     SET user_display_name = ?, user_real_name = ?, updated_at = ?
     WHERE user_id = ? AND user_display_name = '' AND user_real_name = ''`
  ).bind(user.displayName, user.realName, user.updatedAt, user.userId).run()
}

export async function readUser (db: DocDatabase, userId: string): Promise<{ display_name: string, real_name: string, updated_at: string } | null> {
  return await db.prepare(
    'SELECT display_name, real_name, updated_at FROM slack_users WHERE user_id = ?'
  ).bind(userId).first<{ display_name: string, real_name: string, updated_at: string }>()
}

export async function readChannelName (db: DocDatabase, channelId: string): Promise<string | null> {
  const row = await db.prepare('SELECT name FROM slack_channels WHERE channel_id = ?').bind(channelId).first<{ name: string }>()
  return row?.name || null
}

export interface ReactionView {
  name: string
  users: string[]
  count: number
}

export async function reactionsFor (
  db: DocDatabase,
  keys: Array<{ channelId: string, ts: string }>
): Promise<Map<string, ReactionView[]>> {
  const grouped = new Map<string, Map<string, string[]>>()
  if (keys.length === 0) return new Map()
  const clauses = keys.map(() => '(channel_id = ? AND ts = ?)').join(' OR ')
  const params = keys.flatMap(key => [key.channelId, key.ts])
  const { results } = await db.prepare(
    `SELECT channel_id, ts, name, user_id
     FROM slack_reactions
     WHERE removed = 0 AND (${clauses})
     ORDER BY name, user_id`
  ).bind(...params).all<{ channel_id: string, ts: string, name: string, user_id: string }>()
  for (const row of results) {
    const key = `${row.channel_id}:${row.ts}`
    const byName = grouped.get(key) ?? new Map<string, string[]>()
    const users = byName.get(row.name) ?? []
    users.push(row.user_id)
    byName.set(row.name, users)
    grouped.set(key, byName)
  }
  const views = new Map<string, ReactionView[]>()
  for (const [key, byName] of grouped) {
    views.set(key, [...byName.entries()].map(([name, users]) => ({ name, users, count: users.length })))
  }
  return views
}

function fillBlanks (existing: StoredMessage, draft: SlackMessageDraft, patch: Patch) {
  if (!existing.user_id && draft.userId) patch.user_id = draft.userId
  if (!existing.user_display_name && draft.userDisplayName) patch.user_display_name = draft.userDisplayName
  if (!existing.user_real_name && draft.userRealName) patch.user_real_name = draft.userRealName
  if (!existing.channel_name && draft.channelName) patch.channel_name = draft.channelName
  if (!existing.permalink && draft.permalink) patch.permalink = draft.permalink
  if (!existing.team_id && draft.teamId) patch.team_id = draft.teamId
  if (existing.files === '[]' && draft.files.length > 0 && patch.files == null) patch.files = JSON.stringify(draft.files)
  if (existing.reply_count == null && draft.replyCount != null && patch.reply_count == null) patch.reply_count = draft.replyCount
}

async function insertMessage (db: DocDatabase, draft: SlackMessageDraft, conflict: 'nothing' | 'snapshot'): Promise<number> {
  const statement = conflict === 'snapshot'
    ? messageSnapshotStatement(db, draft)
    : db.prepare(
      `INSERT INTO slack_messages (
         channel_id, ts, team_id, channel_name, user_id, user_display_name, user_real_name,
         thread_ts, reply_count, text, edited_at, edit_history, deleted, deleted_at, subtype,
         is_bot, bot_id, mentions, links, files, permalink, raw_event, created_at, updated_at
       ) VALUES (${placeholders(24)})
       ON CONFLICT(channel_id, ts) DO NOTHING`
    ).bind(...messageValues(draft))
  return statementChanges(await statement.run())
}

async function fillBlankMessage (db: DocDatabase, draft: SlackMessageDraft): Promise<number> {
  const mentions = JSON.stringify(draft.mentions)
  const links = JSON.stringify(draft.links)
  const files = JSON.stringify(draft.files)
  const raw = JSON.stringify(draft.rawEvent)
  const result = await db.prepare(
    `UPDATE slack_messages SET
       text = CASE WHEN text = '' THEN ? ELSE text END,
       raw_event = CASE WHEN text = '' THEN ? ELSE raw_event END,
       subtype = CASE WHEN text = '' THEN ? ELSE subtype END,
       is_bot = CASE WHEN text = '' THEN ? ELSE is_bot END,
       bot_id = COALESCE(bot_id, ?),
       mentions = CASE WHEN text = '' THEN ? ELSE mentions END,
       links = CASE WHEN text = '' THEN ? ELSE links END,
       files = CASE WHEN files = '[]' AND ? != '[]' THEN ? ELSE files END,
       thread_ts = COALESCE(thread_ts, ?),
       reply_count = COALESCE(reply_count, ?),
       edited_at = COALESCE(edited_at, ?),
       user_id = COALESCE(user_id, ?),
       user_display_name = CASE WHEN user_display_name = '' AND ? != '' THEN ? ELSE user_display_name END,
       user_real_name = CASE WHEN user_real_name = '' AND ? != '' THEN ? ELSE user_real_name END,
       channel_name = CASE WHEN channel_name = '' AND ? != '' THEN ? ELSE channel_name END,
       permalink = COALESCE(permalink, ?),
       team_id = COALESCE(team_id, ?),
       updated_at = ?
     WHERE channel_id = ? AND ts = ? AND deleted = 0
       AND (
         (text = '' AND ? != '')
         OR (user_id IS NULL AND ? IS NOT NULL)
         OR (user_display_name = '' AND ? != '')
         OR (user_real_name = '' AND ? != '')
         OR (channel_name = '' AND ? != '')
         OR (permalink IS NULL AND ? IS NOT NULL)
         OR (team_id IS NULL AND ? IS NOT NULL)
         OR (files = '[]' AND ? != '[]')
         OR (reply_count IS NULL AND ? IS NOT NULL)
       )`
  ).bind(
    draft.text,
    raw,
    draft.subtype,
    draft.isBot ? 1 : 0,
    draft.botId,
    mentions,
    links,
    files,
    files,
    draft.threadTs,
    draft.replyCount,
    draft.editedAt,
    draft.userId,
    draft.userDisplayName,
    draft.userDisplayName,
    draft.userRealName,
    draft.userRealName,
    draft.channelName,
    draft.channelName,
    draft.permalink,
    draft.teamId,
    draft.updatedAt,
    draft.channelId,
    draft.ts,
    draft.text,
    draft.userId,
    draft.userDisplayName,
    draft.userRealName,
    draft.channelName,
    draft.permalink,
    draft.teamId,
    files,
    draft.replyCount
  ).run()
  return statementChanges(result)
}

function messageValues (draft: SlackMessageDraft): unknown[] {
  return [
    draft.channelId,
    draft.ts,
    draft.teamId,
    draft.channelName,
    draft.userId,
    draft.userDisplayName,
    draft.userRealName,
    draft.threadTs,
    draft.replyCount,
    draft.text,
    draft.editedAt,
    JSON.stringify(draft.editHistory),
    draft.deleted ? 1 : 0,
    draft.deletedAt,
    draft.subtype,
    draft.isBot ? 1 : 0,
    draft.botId,
    JSON.stringify(draft.mentions),
    JSON.stringify(draft.links),
    JSON.stringify(draft.files),
    draft.permalink,
    JSON.stringify(draft.rawEvent),
    draft.createdAt,
    draft.updatedAt
  ]
}

function placeholders (count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function statementChanges (result: unknown): number {
  if (!result || typeof result !== 'object' || !('meta' in result)) return 0
  const changes = (result as { meta?: { changes?: number } }).meta?.changes
  return typeof changes === 'number' ? changes : 0
}

async function patchMessage (db: DocDatabase, channelId: string, ts: string, patch: Patch, updatedAt: string) {
  const keys = Object.keys(patch).filter(key => PATCH_COLUMNS.has(key) && key !== 'updated_at')
  if (keys.length === 0) return
  const assignments = [...keys.map(key => `${key} = ?`), 'updated_at = ?'].join(', ')
  await db.prepare(
    `UPDATE slack_messages SET ${assignments} WHERE channel_id = ? AND ts = ?`
  ).bind(...keys.map(key => patch[key] ?? null), updatedAt, channelId, ts).run()
}

function parseHistory (value: string | null): EditEntry[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const record = entry as { text?: unknown, edited_at?: unknown, user_id?: unknown }
      if (typeof record.text !== 'string') return []
      return [{
        text: record.text,
        edited_at: typeof record.edited_at === 'string' ? record.edited_at : null,
        user_id: typeof record.user_id === 'string' ? record.user_id : null
      }]
    })
  } catch {
    return []
  }
}
