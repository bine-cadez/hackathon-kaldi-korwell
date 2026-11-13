import type { D1Statement, DocDatabase } from './env.ts'
import { SlackApiError, SlackRateLimitPause } from './slack-api.ts'
import type { SlackHistoryMessage, SlackWebClient } from './slack-api.ts'
import { draftFromSlackMessage, SlackDirectory } from './slack-ingest.ts'
import { messageSnapshotStatement, type SlackMessageDraft } from './slack-store.ts'

const PAGE_CAP = 500
// D1 allows 50 queries per invocation on the free plan and 1000 on paid.
// db.batch counts as one query. 40 leaves room for the route's own statements.
export const DEFAULT_QUERY_BUDGET = 40

export class QueryBudgetExceeded extends Error {
  constructor () {
    super('d1_query_budget')
    this.name = 'QueryBudgetExceeded'
  }
}

export interface BackfillResume {
  channelId: string
  historyCursor: string
  pageOffset: number
  threadTs: string | null
  repliesCursor: string | null
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

const statementInners = new WeakMap<object, D1Statement>()

export function withQueryBudget (db: DocDatabase, limit: number): DocDatabase {
  let used = 0
  function charge () {
    if (used + 1 > limit) throw new QueryBudgetExceeded()
    used += 1
  }
  const wrapped: DocDatabase = {
    prepare (query) {
      const inner = db.prepare(query)
      const api = {
        bind (...values: unknown[]) {
          inner.bind(...values)
          return api
        },
        all<T> () {
          charge()
          return inner.all<T>()
        },
        first<T> () {
          charge()
          return inner.first<T>()
        },
        run () {
          charge()
          return inner.run()
        }
      }
      statementInners.set(api, inner)
      return api
    },
    exec (sql) {
      charge()
      return db.exec(sql)
    },
    batch (statements) {
      if (statements.length === 0) return Promise.resolve([])
      charge()
      return db.batch(statements.map(statement => statementInners.get(statement) ?? statement))
    }
  }
  return wrapped
}

export async function backfillSlackChannels (options: {
  db: DocDatabase
  client: SlackWebClient
  channelIds: string[]
  deadlineMs: number
  teamId?: string | null
  resume?: BackfillResume | null
  now?: () => number
  queryBudget?: number
}): Promise<BackfillReport> {
  const clock = options.now ?? Date.now
  const started = clock()
  const deadline = started + options.deadlineMs
  const db = withQueryBudget(options.db, options.queryBudget ?? DEFAULT_QUERY_BUDGET)
  let teamId = options.teamId ?? null
  if (!teamId) {
    try {
      teamId = (await options.client.authTest()).teamId
    } catch {
      teamId = null
    }
  }
  const nowIso = new Date(started).toISOString()
  const directory = new SlackDirectory(db, options.client, teamId, nowIso, false, true)
  const channels: BackfillChannelReport[] = []
  const ids = channelIdsFrom(options.channelIds, options.resume?.channelId)
  const position: BackfillResume = {
    channelId: ids[0] ?? '',
    historyCursor: options.resume?.channelId === ids[0] ? (options.resume?.historyCursor ?? '') : '',
    pageOffset: options.resume?.channelId === ids[0] ? (options.resume?.pageOffset ?? 0) : 0,
    threadTs: options.resume?.channelId === ids[0] ? (options.resume?.threadTs ?? null) : null,
    repliesCursor: options.resume?.channelId === ids[0] ? (options.resume?.repliesCursor ?? null) : null
  }

  try {
    for (let index = 0; index < ids.length; index += 1) {
      const channelId = ids[index] ?? ''
      const report: BackfillChannelReport = { channelId, messages: 0, replies: 0 }
      channels.push(report)
      const resumeHere = index === 0 ? options.resume : null
      if (!resumeHere || resumeHere.channelId !== channelId) {
        position.channelId = channelId
        position.historyCursor = ''
        position.pageOffset = 0
        position.threadTs = null
        position.repliesCursor = null
      }
      try {
        await drainChannel({
          db,
          client: options.client,
          directory,
          teamId,
          nowIso,
          channelId,
          report,
          position,
          resume: resumeHere && resumeHere.channelId === channelId ? resumeHere : null,
          deadline,
          clock
        })
      } catch (error) {
        if (isCleanStop(error)) throw error
        report.error = error instanceof SlackApiError ? error.code : (error instanceof Error ? error.message : 'backfill_failed')
      }
    }
  } catch (error) {
    if (isCleanStop(error)) {
      return { ok: true, partial: true, resume: { ...position }, channels }
    }
    throw error
  }
  return { ok: true, partial: false, resume: null, channels }
}

async function drainChannel (input: {
  db: DocDatabase
  client: SlackWebClient
  directory: SlackDirectory
  teamId: string | null
  nowIso: string
  channelId: string
  report: BackfillChannelReport
  position: BackfillResume
  resume: BackfillResume | null
  deadline: number
  clock: () => number
}) {
  const finishedThreads = new Set<string>()
  if (input.resume?.threadTs) {
    input.position.threadTs = input.resume.threadTs
    input.position.repliesCursor = input.resume.repliesCursor
    await ingestThread(input, input.resume.threadTs, input.resume.repliesCursor ?? '')
    finishedThreads.add(input.resume.threadTs)
    input.position.threadTs = null
    input.position.repliesCursor = null
  }

  let cursor = input.resume?.historyCursor ?? ''
  let offset = input.resume?.pageOffset ?? 0
  for (let page = 0; page < PAGE_CAP; page += 1) {
    input.position.channelId = input.channelId
    input.position.historyCursor = cursor
    input.position.pageOffset = offset
    input.position.threadTs = null
    input.position.repliesCursor = null
    if (input.clock() > input.deadline) throw new QueryBudgetExceeded()
    const history = await input.client.conversationsHistory(input.channelId, cursor)
    const pending: SlackMessageDraft[] = []
    let pendingFrom = offset
    for (let index = offset; index < history.messages.length; index += 1) {
      const message = history.messages[index] ?? {}
      const threadTs = typeof message.ts === 'string' ? message.ts : ''
      const threadRoot = typeof message.thread_ts !== 'string' || message.thread_ts === message.ts
      const replyCount = typeof message.reply_count === 'number' ? message.reply_count : 0
      if (replyCount > 0 && threadTs && threadRoot) {
        await flushDrafts(input.db, input.directory, pending)
        pending.length = 0
        input.report.messages += 1
        const draft = await draftMessage(input, message)
        if (draft) await flushDrafts(input.db, input.directory, [draft])
        if (!finishedThreads.has(threadTs)) {
          input.position.pageOffset = index
          input.position.threadTs = threadTs
          input.position.repliesCursor = ''
          await ingestThread(input, threadTs, '')
          finishedThreads.add(threadTs)
          input.position.threadTs = null
          input.position.repliesCursor = null
        }
        pendingFrom = index + 1
        continue
      }
      const draft = await draftMessage(input, message)
      if (draft) pending.push(draft)
      input.report.messages += 1
    }
    input.position.pageOffset = pendingFrom
    await flushDrafts(input.db, input.directory, pending)
    if (!history.nextCursor) return
    cursor = history.nextCursor
    offset = 0
    input.position.historyCursor = cursor
    input.position.pageOffset = 0
  }
}

async function ingestThread (input: {
  db: DocDatabase
  client: SlackWebClient
  directory: SlackDirectory
  teamId: string | null
  nowIso: string
  channelId: string
  report: BackfillChannelReport
  position: BackfillResume
  deadline: number
  clock: () => number
}, threadTs: string, repliesCursor: string): Promise<void> {
  let cursor = repliesCursor
  for (let page = 0; page < PAGE_CAP; page += 1) {
    input.position.threadTs = threadTs
    input.position.repliesCursor = cursor
    if (input.clock() > input.deadline) throw new QueryBudgetExceeded()
    const replies = await input.client.conversationsReplies(input.channelId, threadTs, cursor)
    const drafts: SlackMessageDraft[] = []
    for (const message of replies.messages) {
      if (message.ts === threadTs) continue
      const draft = await draftMessage(input, message)
      if (draft) drafts.push(draft)
    }
    await flushDrafts(input.db, input.directory, drafts)
    input.report.replies += drafts.length
    if (!replies.nextCursor) return
    cursor = replies.nextCursor
  }
  throw new QueryBudgetExceeded()
}

async function draftMessage (input: {
  directory: SlackDirectory
  teamId: string | null
  nowIso: string
  channelId: string
}, message: SlackHistoryMessage): Promise<SlackMessageDraft | null> {
  return await draftFromSlackMessage(input.directory, message, {
    channelId: input.channelId,
    teamId: input.teamId,
    now: input.nowIso,
    raw: message,
    permalinkApi: false
  })
}

async function flushDrafts (db: DocDatabase, directory: SlackDirectory, drafts: SlackMessageDraft[]) {
  const statements = [...directory.drainWrites(), ...drafts.map(draft => messageSnapshotStatement(db, draft))]
  if (statements.length === 0) return
  await db.batch(statements)
}

function channelIdsFrom (channelIds: string[], resumeChannel: string | undefined): string[] {
  if (!resumeChannel) return channelIds
  const startAt = channelIds.indexOf(resumeChannel)
  if (startAt < 0) return channelIds
  return channelIds.slice(startAt)
}

function isCleanStop (error: unknown): boolean {
  return error instanceof QueryBudgetExceeded || error instanceof SlackRateLimitPause || isQueryLimitError(error)
}

export function isQueryLimitError (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /d1_error|too many (api |sub)?requests|exceeded the maximum number of queries|query limit/i.test(message)
}
