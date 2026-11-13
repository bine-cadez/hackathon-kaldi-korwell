import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defaultLibrary } from '../server/utils/mcp-library.ts'
import { callTool, listTools } from '../server/utils/mcp-protocol.ts'
import { ingestSlackCallback } from '../server/utils/slack-ingest.ts'
import { fakeSlackClient, openSlackDb } from './slack-db.ts'

const origin = 'https://doc-library.example'
const channel = 'C_ALLOW'

function envelope (event: Record<string, unknown>) {
  return { type: 'event_callback', team_id: 'T1', event }
}

test('search_slack on the real archive flags deleted messages', async () => {
  const { db } = openSlackDb()
  const deps = { db, client: fakeSlackClient(), teamId: 'T1', now: '2024-05-01T12:00:00.000Z' }
  await ingestSlackCallback(deps, envelope({ type: 'message', channel, user: 'UMAJA', text: 'datoteka za sestanek', ts: '1714551200.000400' }))
  await ingestSlackCallback(deps, envelope({ type: 'message', channel, user: 'UANA', text: 'nova datoteka', ts: '1714551300.000100' }))
  await ingestSlackCallback(deps, envelope({
    type: 'message',
    subtype: 'message_deleted',
    channel,
    ts: '1714552000.000100',
    deleted_ts: '1714551200.000400',
    previous_message: { text: 'datoteka za sestanek', user: 'UMAJA', ts: '1714551200.000400' }
  }))

  const env = { DB: db }
  assert.deepEqual((await listTools(defaultLibrary, env)).map(tool => tool.name), ['search', 'fetch', 'search_slack'])
  const result = await callTool(defaultLibrary, env, '', origin, 'search_slack', { arguments: { query: 'datoteka' } })
  assert.equal(result.isError, undefined)
  const { results } = result.structuredContent as { results: Array<{ id: string, deleted: boolean, deletedAt: string | null }> }
  const gone = results.find(hit => hit.id === `${channel}/1714551200.000400`)
  const live = results.find(hit => hit.id === `${channel}/1714551300.000100`)
  assert.equal(gone?.deleted, true)
  assert.ok(gone?.deletedAt)
  assert.equal(live?.deleted, false)
  assert.equal(live?.deletedAt, null)
})

test('search_slack is hidden and refused before the archive migration', async () => {
  const { db } = openSlackDb(false)
  const env = { DB: db }
  assert.deepEqual((await listTools(defaultLibrary, env)).map(tool => tool.name), ['search', 'fetch'])
  const result = await callTool(defaultLibrary, env, '', origin, 'search_slack', { arguments: { query: 'x' } })
  assert.equal(result.isError, true)
})

test('document search needs words or an author; a date range alone is refused', async () => {
  const calls: unknown[] = []
  const library = {
    ...defaultLibrary,
    searchDocuments: async (...args: unknown[]) => { calls.push(args); return { matches: [] } }
  }
  const dateOnly = await callTool(library, {}, '', origin, 'search', { arguments: { from: '2026-01-01', to: '2026-02-01' } })
  assert.equal(dateOnly.isError, true)
  assert.equal(calls.length, 0)
  const byAuthor = await callTool(library, {}, '', origin, 'search', { arguments: { author: 'Ada', from: '2026-01-01' } })
  assert.equal(byAuthor.isError, undefined)
  assert.equal(calls.length, 1)
})
