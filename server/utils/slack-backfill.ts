import type { SlackWebClient } from './slack-api.ts'
import { SlackApiError } from './slack-api.ts'
import type { DocDatabase } from './env.ts'
import { ingestHistoryMessage } from './slack-ingest.ts'

const PAGE_CAP = 500

export interface BackfillResume {
  channelId: string
  historyCursor: string
}

export interface BackfillChannelReport {
  channelId: string
  messages: number
  replies: number
  error?: string
}

export interface BackfillReport {
  ok: true
  partial: boolean
  resume: BackfillResume | null
  channels: BackfillChannelReport[]
}

export async function backfillSlackChannels (options: {
  db: DocDatabase
  client: SlackWebClient
  channelIds: string[]
  deadlineMs: number
  teamId?: string | null
  resume?: BackfillResume | null
  now?: () => number
}): Promise<BackfillReport> {
  const clock = options.now ?? Date.now
  const started = clock()
  const deadline = started + options.deadlineMs
  let teamId = options.teamId ?? null
  if (!teamId) {
    try {
      teamId = (await options.client.authTest()).teamId
    } catch {
      teamId = null
    }
  }
  const channels: BackfillChannelReport[] = []
  const startAt = Math.max(0, options.channelIds.indexOf(options.resume?.channelId ?? ''))
  const ids = startAt > 0 || options.resume?.channelId === options.channelIds[0] ? options.channelIds.slice(startAt) : options.channelIds

  for (const channelId of ids) {
    const report: BackfillChannelReport = { channelId, messages: 0, replies: 0 }
    channels.push(report)
    let cursor = options.resume?.channelId === channelId ? (options.resume.historyCursor || '') : ''
    try {
      for (let page = 0; page < PAGE_CAP; page += 1) {
        if (clock() > deadline) {
          return { ok: true, partial: true, resume: { channelId, historyCursor: cursor }, channels }
        }
        const history = await options.client.conversationsHistory(channelId, cursor)
        for (const message of history.messages) {
          const saved = await ingestHistoryMessage({
            db: options.db,
            client: options.client,
            teamId,
            preferPermalinkApi: false
          }, message, channelId)
          report.messages += 1
          const threadTs = typeof message.ts === 'string' ? message.ts : ''
          const threadRoot = typeof message.thread_ts !== 'string' || message.thread_ts === message.ts
          if (saved.replyCount > 0 && threadTs && threadRoot) {
            const thread = await ingestThread(options.db, options.client, teamId, channelId, threadTs, deadline, clock)
            report.replies += thread.count
            if (!thread.complete) {
              return { ok: true, partial: true, resume: { channelId, historyCursor: cursor }, channels }
            }
          }
        }
        if (!history.nextCursor) {
          cursor = ''
          break
        }
        cursor = history.nextCursor
      }
      if (cursor) return { ok: true, partial: true, resume: { channelId, historyCursor: cursor }, channels }
    } catch (error) {
      report.error = error instanceof SlackApiError ? error.code : (error instanceof Error ? error.message : 'backfill_failed')
    }
  }
  return { ok: true, partial: false, resume: null, channels }
}

async function ingestThread (
  db: DocDatabase,
  client: SlackWebClient,
  teamId: string | null,
  channelId: string,
  threadTs: string,
  deadline: number,
  clock: () => number
): Promise<{ count: number, complete: boolean }> {
  let cursor = ''
  let count = 0
  for (let page = 0; page < PAGE_CAP; page += 1) {
    if (clock() > deadline) return { count, complete: false }
    const replies = await client.conversationsReplies(channelId, threadTs, cursor)
    for (const message of replies.messages) {
      if (message.ts === threadTs) continue
      await ingestHistoryMessage({ db, client, teamId, preferPermalinkApi: false }, message, channelId)
      count += 1
    }
    if (!replies.nextCursor) return { count, complete: true }
    cursor = replies.nextCursor
  }
  return { count, complete: false }
}
