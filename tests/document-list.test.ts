import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { DocDatabase, DocLibraryEnv } from '../server/utils/env.ts'
import { listDocuments } from '../server/utils/document-list.ts'

const initSql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
const searchSql = readFileSync(new URL('../migrations/0002_document_search.sql', import.meta.url), 'utf8')
// Main's 0005 (uploader, original file) and 0006 (content hash), then 0007 (title sort, FTS file name).
const laterSql = ['0005_document_source', '0006_document_content_hash', '0007_document_title_sort']
  .map(name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'))
const applyLater = (sqlite: DatabaseSync) => laterSql.forEach(sql => sqlite.exec(sql))

function wrap (sqlite: DatabaseSync): DocDatabase {
  return {
    exec (sql) {
      sqlite.exec(sql)
      return Promise.resolve()
    },
    prepare (query) {
      const statement = sqlite.prepare(query)
      let bound: unknown[] = []
      const api = {
        bind (...values: unknown[]) {
          bound = values
          return api
        },
        all: () => Promise.resolve({ results: statement.all(...(bound as [])) }),
        first: () => Promise.resolve(statement.get(...(bound as [])) ?? null),
        run: () => {
          statement.run(...(bound as []))
          return Promise.resolve()
        }
      }
      return api
    },
    batch: statements => Promise.all(statements.map(statement => statement.run()))
  }
}

function envFor (sqlite: DatabaseSync): DocLibraryEnv {
  return {
    DB: wrap(sqlite),
    VECTORIZE: { upsert: async () => ({}), deleteByIds: async () => ({}), query: async () => ({ matches: [] }) }
  }
}

const DOCS = [
  { id: 'd1', title: 'Invoice_2024_03', author: 'Maja Župan', createdAt: '2024-03-02T10:00:00.000Z', fileName: 'Invoice_2024_03.pdf', uploadedBy: 'maja.zupan@kaldi.si' },
  { id: 'd2', title: 'Quarterly report', author: 'Janez Novak', createdAt: '2024-05-10T09:00:00.000Z', fileName: 'Poročilo Q2.docx', uploadedBy: 'janez.novak@kaldi.si' },
  { id: 'd3', title: 'Onboarding runbook', author: 'Maja Župan', createdAt: '2024-06-01T23:59:59.000Z', fileName: null, uploadedBy: 'janez.novak@kaldi.si' },
  { id: 'd4', title: 'alpha notes', author: null, createdAt: '2024-06-02T00:00:00.000Z', fileName: null, uploadedBy: null },
  { id: 'd5', title: 'Čokolada recipe', author: 'Ana Kovač', createdAt: '2024-07-15T12:00:00.000Z', fileName: 'recept.txt', uploadedBy: null }
]

// Rows are inserted with the 0002 columns, then 0005–0007 run so the library
// reads the schema production has, with uploader and original-file columns filled in.
function seeded () {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(initSql)
  sqlite.exec(searchSql)
  for (const doc of DOCS) {
    sqlite.prepare('INSERT INTO documents (id, title, body, author, r2_key, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
      .run(doc.id, doc.title, `Body of ${doc.title}`, doc.author, doc.createdAt)
    sqlite.prepare('INSERT INTO chunks (id, document_id, chunk_index, content, token_estimate, created_at) VALUES (?, ?, 0, ?, 1, ?)')
      .run(`${doc.id}-c0`, doc.id, 'chunk', doc.createdAt)
  }
  applyLater(sqlite)
  for (const doc of DOCS) {
    sqlite.prepare('UPDATE documents SET source_key = ?, source_filename = ?, source_size = ?, uploaded_by = ? WHERE id = ?')
      .run(doc.fileName ? `documents/${doc.id}/original` : null, doc.fileName, doc.fileName ? 2048 : null, doc.uploadedBy, doc.id)
  }
  return { env: envFor(sqlite) }
}

const ids = (page: { documents: Array<{ id: string }> }) => page.documents.map(document => document.id)

test('pages through documents newest first with totals', async () => {
  const { env } = seeded()
  const first = await listDocuments(env, { pageSize: 2 })
  assert.deepEqual(ids(first), ['d5', 'd4'])
  assert.equal(first.total, 5)
  assert.equal(first.totalPages, 3)
  assert.equal(first.documents[0]?.chunkCount, 1)
  assert.equal(first.documents[0]?.author, 'Ana Kovač')

  const last = await listDocuments(env, { pageSize: 2, page: 3 })
  assert.deepEqual(ids(last), ['d1'])

  const beyond = await listDocuments(env, { pageSize: 2, page: 9 })
  assert.deepEqual(ids(beyond), [])
  assert.equal(beyond.total, 5)
})

test('searches the title and the uploader, with prefixes and without accents', async () => {
  const { env } = seeded()
  assert.deepEqual(ids(await listDocuments(env, { q: 'zupan' })), ['d3', 'd1'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'Žup' })), ['d3', 'd1'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'invoice 2024' })), ['d1'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'maja runbook' })), ['d3'])
  // Substring inside a word comes from the LIKE half.
  assert.deepEqual(ids(await listDocuments(env, { q: 'port' })), ['d2'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'cokolada' })), ['d5'])
  // The body is not searched here; that is the main search page's job.
  assert.deepEqual(ids(await listDocuments(env, { q: 'Body' })), [])
})
