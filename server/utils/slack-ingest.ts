import type { SlackWebClient } from './slack-api.ts'
import type { DocDatabase } from './env.ts'
import {
  readChannelName,
  readUser,
  rememberChannel,
  rememberUser,
  renameChannel,
  setReaction,
  storeDeletedMessage,
  storeEditedMessage,
  storeNewMessage,
  storeReplyCount,
  storeSnapshot,
  type SlackFileMeta,
  type SlackMessageDraft
} from './slack-store.ts'
import { parseSlackText, slackPermalink, slackTsToIso, type SlackLink } from './slack-text.ts'

const USER_CACHE_MS = 24 * 60 * 60 * 1000

export interface IngestDeps {
  db: DocDatabase
  client: SlackWebClient | null
  teamId?: string | null
  now?: string
  preferPermalinkApi?: boolean
}

export function channelIdFromEnvelope (envelope: unknown): string | null {
  const event = record(record(envelope)?.event)
  if (!event) return null
  if (typeof event.channel === 'string' && event.channel) return event.channel
  const channel = record(event.channel)
  if (typeof channel?.id === 'string' && channel.id) return channel.id
  const item = record(event.item)
  if (typeof item?.channel === 'string' && item.channel) return item.channel
  return null
}

export async function ingestSlackCallback (deps: IngestDeps, envelope: unknown): Promise<{ action: string }> {
  const root = record(envelope)
  const event = record(root?.event)
  if (!event) return { action: 'ignored' }
  const teamId = deps.teamId ?? text(root?.team_id) ?? text(event.team) ?? null
  const now = deps.now ?? new Date().toISOString()
  const directory = new SlackDirectory(deps.db, deps.client, teamId, now, deps.preferPermalinkApi !== false)
  const type = text(event.type)

  if (type === 'reaction_added' || type === 'reaction_removed') {
    return applyReaction(deps.db, event, type === 'reaction_removed')
  }
  if (type === 'channel_rename' || type === 'group_rename') {
    const channel = record(event.channel)
    const channelId = text(channel?.id)
    const name = text(channel?.name) || text(channel?.name_normalized)
    if (!channelId || !name) return { action: 'ignored' }
    await renameChannel(deps.db, channelId, teamId, name, now)
    return { action: 'renamed' }
  }
  if (type !== 'message') return { action: 'ignored' }

  const channelId = typeof event.channel === 'string' ? event.channel : ''
  if (!channelId) return { action: 'ignored' }
  const subtype = text(event.subtype)
  if (subtype === 'message_changed') return applyEdit(deps.db, directory, event, channelId, teamId, now)
  if (subtype === 'message_deleted') return applyDelete(deps.db, directory, event, channelId, teamId, now)
  if (subtype === 'message_replied') return applyReplied(deps.db, directory, event, channelId, teamId, now)
  const draft = await draftFromSlackMessage(directory, event, {
    channelId,
    teamId,
    now,
    raw: event,
    permalinkApi: true
  })
  if (!draft) return { action: 'ignored' }
  const outcome = await storeNewMessage(deps.db, draft)
  return { action: outcome }
}

export async function ingestHistoryMessage (
  deps: IngestDeps,
  message: Record<string, unknown>,
  channelId: string
): Promise<{ action: string, replyCount: number }> {
  const now = deps.now ?? new Date().toISOString()
  const teamId = deps.teamId ?? text(message.team) ?? null
  const directory = new SlackDirectory(deps.db, deps.client, teamId, now, false)
  const draft = await draftFromSlackMessage(directory, message, {
    channelId,
    teamId,
    now,
    raw: message,
    permalinkApi: false
  })
  if (!draft) return { action: 'ignored', replyCount: 0 }
  const outcome = await storeSnapshot(deps.db, draft)
  return { action: outcome, replyCount: draft.replyCount ?? 0 }
}

async function applyEdit (
  db: DocDatabase,
  directory: SlackDirectory,
  event: Record<string, unknown>,
  channelId: string,
  teamId: string | null,
  now: string
): Promise<{ action: string }> {
  const message = record(event.message)
  if (!message) return { action: 'ignored' }
  const previous = record(event.previous_message)
  const draft = await draftFromSlackMessage(directory, message, {
    channelId,
    teamId,
    now,
    raw: event,
    permalinkApi: true
  })
  if (!draft) return { action: 'ignored' }
  const edited = record(message.edited)
  draft.editedAt = text(edited?.ts) || text(event.ts) || draft.editedAt
  const editor = text(edited?.user)
  const previousText = text(previous?.text)
  const outcome = await storeEditedMessage(db, draft, previousText || null, editor || null)
  return { action: outcome }
}

async function applyDelete (
  db: DocDatabase,
  directory: SlackDirectory,
  event: Record<string, unknown>,
  channelId: string,
  teamId: string | null,
  now: string
): Promise<{ action: string }> {
  const previous = record(event.previous_message) ?? {}
  const ts = text(event.deleted_ts) || text(previous.ts)
  if (!ts) return { action: 'ignored' }
  const source = { ...previous, ts, subtype: 'message_deleted' }
  const draft = await draftFromSlackMessage(directory, source, {
    channelId,
    teamId,
    now,
    raw: event,
    permalinkApi: false
  })
  if (!draft) return { action: 'ignored' }
  draft.deleted = true
  draft.deletedAt = slackTsToIso(text(event.ts)) || now
  draft.subtype = 'message_deleted'
  const outcome = await storeDeletedMessage(db, draft)
  return { action: outcome }
}

async function applyReplied (
  db: DocDatabase,
  directory: SlackDirectory,
  event: Record<string, unknown>,
  channelId: string,
  teamId: string | null,
  now: string
): Promise<{ action: string }> {
  const message = record(event.message)
  if (!message) return { action: 'ignored' }
  const ts = text(message.ts)
  const replyCount = typeof message.reply_count === 'number' ? message.reply_count : null
  if (!ts || replyCount == null) return { action: 'ignored' }
  const draft = await draftFromSlackMessage(directory, message, {
    channelId,
    teamId,
    now,
    raw: event,
    permalinkApi: false
  })
  if (draft) await storeNewMessage(db, draft)
  await storeReplyCount(db, channelId, ts, replyCount, now)
  return { action: 'reply_count' }
}

async function applyReaction (db: DocDatabase, event: Record<string, unknown>, removed: boolean): Promise<{ action: string }> {
  const item = record(event.item)
  const channelId = text(item?.channel)
  const ts = text(item?.ts)
  const name = text(event.reaction)
  const userId = text(event.user)
  if (!channelId || !ts || !name || !userId || text(item?.type) !== 'message') return { action: 'ignored' }
  await setReaction(db, {
    channelId,
    ts,
    name,
    userId,
    removed,
    eventTs: text(event.event_ts) || text(event.ts) || ts
  })
  return { action: removed ? 'reaction_removed' : 'reaction_added' }
}

export async function draftFromSlackMessage (
  directory: SlackDirectory,
  message: Record<string, unknown>,
  context: {
    channelId: string
    teamId: string | null
    now: string
    raw: unknown
    permalinkApi: boolean
  }
): Promise<SlackMessageDraft | null> {
  const ts = text(message.ts)
  if (!ts) return null
  const subtype = text(message.subtype)
  const botProfile = record(message.bot_profile)
  const botId = text(message.bot_id) || text(botProfile?.id) || null
  const userId = text(message.user) || null
  const fallbackName = text(message.username) || text(botProfile?.name) || null
  const names = userId
    ? await directory.user(userId, fallbackName)
    : { displayName: fallbackName ?? '', realName: '' }
  const channelName = await directory.channel(context.channelId)
  const threadTs = text(message.thread_ts) || null
  const body = messageText(message)
  const parsed = parseSlackText(body)
  const permalink = await directory.permalink(context.channelId, ts, threadTs, context.permalinkApi)
  const edited = record(message.edited)
  return {
    channelId: context.channelId,
    ts,
    teamId: context.teamId,
    channelName,
    userId,
    userDisplayName: names.displayName,
    userRealName: names.realName,
    threadTs,
    replyCount: typeof message.reply_count === 'number' ? message.reply_count : null,
    text: body,
    editedAt: text(edited?.ts) || null,
    editHistory: [],
    deleted: subtype === 'tombstone',
    deletedAt: subtype === 'tombstone' ? (slackTsToIso(ts) || context.now) : null,
    subtype: subtype || null,
    isBot: subtype === 'bot_message' || Boolean(botId),
    botId,
    mentions: parsed.mentions,
    links: parsed.links,
    files: fileMetadata(message.files),
    permalink,
    rawEvent: context.raw,
    createdAt: context.now,
    updatedAt: context.now
  }
}

export class SlackDirectory {
  private db: DocDatabase
  private client: SlackWebClient | null
  private teamId: string | null
  private now: string
  private preferPermalinkApi: boolean

  constructor (
    db: DocDatabase,
    client: SlackWebClient | null,
    teamId: string | null,
    now: string,
    preferPermalinkApi: boolean
  ) {
    this.db = db
    this.client = client
    this.teamId = teamId
    this.now = now
    this.preferPermalinkApi = preferPermalinkApi
  }

  async user (userId: string, fallbackName?: string | null): Promise<{ displayName: string, realName: string }> {
    const cached = await readUser(this.db, userId)
    const fresh = cached ? Date.now() - Date.parse(cached.updated_at) < USER_CACHE_MS : false
    if (cached && fresh && (cached.display_name || cached.real_name)) {
      return { displayName: cached.display_name, realName: cached.real_name }
    }
    if (!this.client) {
      return {
        displayName: cached?.display_name || fallbackName || '',
        realName: cached?.real_name || ''
      }
    }
    try {
      const info = await this.client.usersInfo(userId)
      if (!info) {
        return {
          displayName: cached?.display_name || fallbackName || '',
          realName: cached?.real_name || ''
        }
      }
      await rememberUser(this.db, {
        userId,
        teamId: this.teamId,
        displayName: info.displayName,
        realName: info.realName,
        updatedAt: this.now
      })
      return info
    } catch (error) {
      console.error(JSON.stringify({
        message: 'slack_user_lookup_failed',
        userId,
        error: error instanceof Error ? error.message : String(error)
      }))
      return {
        displayName: cached?.display_name || fallbackName || '',
        realName: cached?.real_name || ''
      }
    }
  }

  async channel (channelId: string): Promise<string> {
    const cached = await readChannelName(this.db, channelId)
    if (cached) return cached
    if (!this.client) return ''
    try {
      const info = await this.client.conversationsInfo(channelId)
      if (!info?.name) return ''
      await rememberChannel(this.db, channelId, this.teamId, info.name, this.now)
      return info.name
    } catch (error) {
      console.error(JSON.stringify({
        message: 'slack_channel_lookup_failed',
        channelId,
        error: error instanceof Error ? error.message : String(error)
      }))
      return ''
    }
  }

  async permalink (channelId: string, ts: string, threadTs: string | null, permalinkApi: boolean): Promise<string> {
    const constructed = slackPermalink(channelId, ts, threadTs)
    if (!permalinkApi || !this.preferPermalinkApi || !this.client) return constructed
    try {
      const live = await this.client.getPermalink(channelId, ts)
      return live || constructed
    } catch (error) {
      console.error(JSON.stringify({
        message: 'slack_permalink_failed',
        channelId,
        error: error instanceof Error ? error.message : String(error)
      }))
      return constructed
    }
  }
}

function messageText (message: Record<string, unknown>): string {
  const direct = text(message.text)
  if (direct) return direct
  if (!Array.isArray(message.attachments)) return ''
  return message.attachments.map((attachment) => {
    const item = record(attachment)
    return text(item?.text) || text(item?.fallback)
  }).filter(Boolean).join('\n')
}

function fileMetadata (value: unknown): SlackFileMeta[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).flatMap((file) => {
    const item = record(file)
    if (!item) return []
    return [{
      id: text(item.id) || null,
      name: text(item.name) || text(item.title) || null,
      title: text(item.title) || null,
      mimetype: text(item.mimetype) || null,
      filetype: text(item.filetype) || null,
      size: typeof item.size === 'number' ? item.size : null,
      permalink: text(item.permalink) || null
    }]
  })
}

function record (value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function text (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

