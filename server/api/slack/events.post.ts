import { createError, defineEventHandler, getHeader, readRawBody, setResponseStatus } from 'h3'
import { createSlackWebClient } from '../../utils/slack-api.ts'
import { channelAllowed, slackSettings } from '../../utils/slack-config.ts'
import { readCloudflareEnv, toHttpError } from '../../utils/env.ts'
import { channelIdFromEnvelope, ingestSlackCallback } from '../../utils/slack-ingest.ts'
import { deferAfterResponse } from '../../utils/slack-runtime.ts'
import { verifySlackSignature } from '../../utils/slack-signature.ts'
import { slackArchiveReady } from '../../utils/slack-store.ts'

const MAX_BODY_CHARS = 1_000_000

function notConfigured (message: string) {
  return createError({
    statusCode: 503,
    statusMessage: 'Slack archive is not configured',
    data: { message }
  })
}

export default defineEventHandler(async (event) => {
  try {
    const env = readCloudflareEnv(event)
    const settings = slackSettings(env)
    if (!settings.signingSecret) {
      throw notConfigured('Slack archive is not configured. SLACK_SIGNING_SECRET is unset.')
    }

    const rawBody = await readRawBody(event) ?? ''
    if (rawBody.length > MAX_BODY_CHARS) {
      throw createError({
        statusCode: 413,
        statusMessage: 'Payload too large',
        data: { message: 'Slack payload is too large.' }
      })
    }

    const verdict = await verifySlackSignature({
      signingSecret: settings.signingSecret,
      timestamp: getHeader(event, 'x-slack-request-timestamp'),
      signature: getHeader(event, 'x-slack-signature'),
      rawBody
    })
    if (!verdict.ok) {
      console.log(JSON.stringify({ message: 'slack_signature_rejected', reason: verdict.reason }))
      setResponseStatus(event, 401)
      return { ok: false }
    }

    let envelope: unknown
    try {
      envelope = rawBody ? JSON.parse(rawBody) : null
    } catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid JSON',
        data: { message: 'Slack payload is not JSON.' }
      })
    }

    const root = envelope && typeof envelope === 'object' ? envelope as { type?: unknown, challenge?: unknown, team_id?: unknown } : {}
    if (root.type === 'url_verification') {
      return { challenge: typeof root.challenge === 'string' ? root.challenge : '' }
    }

    const channelId = channelIdFromEnvelope(envelope)
    if (!channelAllowed(settings.channelIds, channelId)) {
      console.log(JSON.stringify({
        message: 'slack_event_ignored',
        reason: channelId ? 'channel' : 'no_channel',
        channelId
      }))
      return { ok: true, ignored: true }
    }

    if (!env?.DB) throw notConfigured('Slack archive is not configured. D1 binding DB is unavailable.')
    let ready = false
    try {
      ready = await slackArchiveReady(env.DB)
    } catch (error) {
      console.error(JSON.stringify({
        message: 'slack_schema_check_failed',
        error: error instanceof Error ? error.message : String(error)
      }))
      ready = false
    }
    if (!ready) {
      throw notConfigured('Slack archive is not configured. Apply migrations/0003_slack_archive.sql.')
    }

    const retry = getHeader(event, 'x-slack-retry-num')
    const teamId = typeof root.team_id === 'string' ? root.team_id : null
    const client = settings.botToken ? createSlackWebClient(settings.botToken) : null
    const work = ingestSlackCallback({ db: env.DB, client, teamId }, envelope).then((result) => {
      console.log(JSON.stringify({
        message: 'slack_event_stored',
        channelId,
        action: result.action,
        retry: retry ?? null
      }))
    }).catch((error) => {
      console.error(JSON.stringify({
        message: 'slack_event_failed',
        channelId,
        retry: retry ?? null,
        error: error instanceof Error ? error.message : String(error)
      }))
    })
    deferAfterResponse(event, work)
    return { ok: true }
  } catch (error) {
    throw toHttpError(error)
  }
})
