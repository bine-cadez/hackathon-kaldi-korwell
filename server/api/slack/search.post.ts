import { createError, defineEventHandler, readBody } from 'h3'
import { requireDatabase, toHttpError } from '../../utils/env.ts'
import { searchSlackMessages } from '../../utils/slack-search.ts'

function text (value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export default defineEventHandler(async (event) => {
  try {
    const db = requireDatabase(event)
    const payload = await readBody(event)
    const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    const requested = typeof record.limit === 'number' ? record.limit : Number(record.limit)
    const result = await searchSlackMessages(db, {
      query: text(record.query),
      channel: text(record.channel),
      user: text(record.user),
      from: text(record.from),
      to: text(record.to),
      limit: Number.isFinite(requested) ? requested : undefined
    })
    if (!result.configured) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Slack archive is not configured',
        data: { message: 'Slack archive is not configured. Apply migrations/0003_slack_archive.sql.' }
      })
    }
    return {
      configured: true,
      query: text(record.query),
      channel: text(record.channel) || null,
      user: text(record.user) || null,
      from: text(record.from) || null,
      to: text(record.to) || null,
      matches: result.matches
    }
  } catch (error) {
    throw toHttpError(error)
  }
})
