import { createError, defineEventHandler, readBody } from 'h3'
import { createSlackWebClient } from '../../utils/slack-api.ts'
import { backfillSlackChannels, type BackfillResume } from '../../utils/slack-backfill.ts'
import { parseChannelIds, slackSettings } from '../../utils/slack-config.ts'
import { readCloudflareEnv, requireDatabase, toHttpError } from '../../utils/env.ts'
import { slackArchiveReady } from '../../utils/slack-store.ts'

function notConfigured (message: string) {
  return createError({
    statusCode: 503,
    statusMessage: 'Slack archive is not configured',
    data: { message }
  })
}

export default defineEventHandler(async (event) => {
  try {
    const settings = slackSettings(readCloudflareEnv(event))
    if (!settings.botToken) throw notConfigured('Slack archive is not configured. SLACK_BOT_TOKEN is unset.')
    if (settings.channelIds.length === 0) throw notConfigured('Slack archive is not configured. SLACK_CHANNEL_IDS is empty.')
    const db = requireDatabase(event)
    const ready = await slackArchiveReady(db).catch(() => false)
    if (!ready) throw notConfigured('Slack archive is not configured. Apply migrations/0003_slack_archive.sql.')

    const payload = await readBody(event).catch(() => null)
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const requested = Array.isArray(record.channelIds)
      ? record.channelIds.filter((id): id is string => typeof id === 'string')
      : []
    const channelIds = requested.length > 0 ? parseChannelIds(requested.join(',')) : settings.channelIds
    const denied = channelIds.filter(id => !settings.channelIds.includes(id))
    if (denied.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Channel is not allow-listed',
        data: { message: 'Backfill only accepts channel ids from SLACK_CHANNEL_IDS.' }
      })
    }
    const resume = resumeFrom(record.resume)
    const deadlineMs = import.meta.dev ? 60_000 : 20_000
    const started = Date.now()
    const report = await backfillSlackChannels({
      db,
      client: createSlackWebClient(settings.botToken, {
        allowWait: (retryAfterMs) => Date.now() + retryAfterMs <= started + deadlineMs
      }),
      channelIds,
      resume,
      deadlineMs
    })
    console.log(JSON.stringify({
      message: 'slack_backfill',
      partial: report.partial,
      channels: report.channels.map(channel => ({
        channelId: channel.channelId,
        messages: channel.messages,
        replies: channel.replies,
        error: channel.error ?? null
      }))
    }))
    return report
  } catch (error) {
    throw toHttpError(error)
  }
})

function resumeFrom (value: unknown): BackfillResume | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    channelId?: unknown
    historyCursor?: unknown
    pageOffset?: unknown
    threadTs?: unknown
    repliesCursor?: unknown
  }
  if (typeof record.channelId !== 'string' || !record.channelId) return null
  const pageOffset = typeof record.pageOffset === 'number' && Number.isFinite(record.pageOffset)
    ? Math.max(0, Math.trunc(record.pageOffset))
    : 0
  return {
    channelId: record.channelId,
    historyCursor: typeof record.historyCursor === 'string' ? record.historyCursor : '',
    pageOffset,
    threadTs: typeof record.threadTs === 'string' && record.threadTs ? record.threadTs : null,
    repliesCursor: typeof record.repliesCursor === 'string' ? record.repliesCursor : null
  }
}
