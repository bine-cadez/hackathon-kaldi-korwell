import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { DocDatabase, DocLibraryEnv } from '../server/utils/env.ts'
import { listDocumentFacets, listDocuments, parseDocumentListQuery, queryTokens } from '../server/utils/document-list.ts'
import { slovenianSortKey } from '../shared/utils/text.ts'

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

type Migration = '0001' | '0002' | '0007'

// Rows are inserted with the columns of `migration`. With 0007, they are
// inserted after 0002 and before 0005–0007 run, so 0007's backfill is exercised,
// then uploader and original-file columns are filled in the way new saves would.
function seeded (migration: Migration = '0002') {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(initSql)
  if (migration !== '0001') sqlite.exec(searchSql)
  for (const doc of DOCS) {
    if (migration !== '0001') {
      sqlite.prepare('INSERT INTO documents (id, title, body, author, r2_key, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
        .run(doc.id, doc.title, `Body of ${doc.title}`, doc.author, doc.createdAt)
    } else {
      sqlite.prepare('INSERT INTO documents (id, title, body, r2_key, created_at) VALUES (?, ?, ?, NULL, ?)')
        .run(doc.id, doc.title, `Body of ${doc.title}`, doc.createdAt)
    }
    sqlite.prepare('INSERT INTO chunks (id, document_id, chunk_index, content, token_estimate, created_at) VALUES (?, ?, 0, ?, 1, ?)')
      .run(`${doc.id}-c0`, doc.id, 'chunk', doc.createdAt)
  }
  if (migration === '0007') {
    applyLater(sqlite)
    for (const doc of DOCS) {
      sqlite.prepare('UPDATE documents SET source_key = ?, source_filename = ?, source_size = ?, uploaded_by = ? WHERE id = ?')
        .run(doc.fileName ? `documents/${doc.id}/original` : null, doc.fileName, doc.fileName ? 2048 : null, doc.uploadedBy, doc.id)
    }
  }
  return { env: envFor(sqlite), sqlite }
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

test('sorts oldest first and by title, case-insensitively', async () => {
  const { env } = seeded()
  assert.deepEqual(ids(await listDocuments(env, { sort: 'oldest' })), ['d1', 'd2', 'd3', 'd4', 'd5'])
  // Before 0007: NOCASE folds ASCII only, so "Čokolada" sorts after Z.
  assert.deepEqual(ids(await listDocuments(env, { sort: 'title' })), ['d4', 'd1', 'd3', 'd2', 'd5'])
})

test('after 0007, titles sort in Slovenian order', async () => {
  const { env } = seeded('0007')
  // Čokolada sits after any c… title and before d…; here, between alpha and Invoice.
  assert.deepEqual(ids(await listDocuments(env, { sort: 'title' })), ['d4', 'd5', 'd1', 'd3', 'd2'])
})

test('the 0007 backfill builds the same sort key as new saves', () => {
  const titles = ['Čokolada', 'ćevapi', 'Đuro', 'Šola', 'žaga', 'Zebra', 'Café Ölung', 'CZ', 'Éclair', 'cesta']
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(initSql)
  sqlite.exec(searchSql)
  titles.forEach((title, index) => {
    sqlite.prepare('INSERT INTO documents (id, title, body, created_at) VALUES (?, ?, ?, ?)').run(`t${index}`, title, 'b', '2024-01-01')
  })
  applyLater(sqlite)
  const rows = sqlite.prepare('SELECT title, title_sort FROM documents ORDER BY title_sort').all() as Array<{ title: string, title_sort: string }>
  for (const row of rows) assert.equal(row.title_sort, slovenianSortKey(row.title), row.title)
  assert.deepEqual(rows.map(row => row.title), ['Café Ölung', 'cesta', 'CZ', 'Čokolada', 'ćevapi', 'Đuro', 'Éclair', 'Šola', 'Zebra', 'žaga'])
})

test('after 0007, rows written without a sort key get one from the trigger', () => {
  const { sqlite } = seeded('0007')
  // As older code or a plain SQL insert would: no title_sort column in the insert.
  sqlite.prepare('INSERT INTO documents (id, title, body, created_at) VALUES (?, ?, ?, ?)').run('d6', 'Žaga', 'b', '2024-08-01')
  assert.equal((sqlite.prepare('SELECT title_sort FROM documents WHERE id = ?').get('d6') as { title_sort: string }).title_sort, slovenianSortKey('Žaga'))
  // A rename keeps the key in step; a key set by the app is left alone.
  sqlite.prepare('UPDATE documents SET title = ? WHERE id = ?').run('Čebula', 'd6')
  assert.equal((sqlite.prepare('SELECT title_sort FROM documents WHERE id = ?').get('d6') as { title_sort: string }).title_sort, slovenianSortKey('Čebula'))
  sqlite.prepare('INSERT INTO documents (id, title, body, created_at, title_sort) VALUES (?, ?, ?, ?, ?)').run('d7', 'Éclair', 'b', '2024-08-01', 'custom')
  assert.equal((sqlite.prepare('SELECT title_sort FROM documents WHERE id = ?').get('d7') as { title_sort: string }).title_sort, 'custom')
})

test('after 0007, search covers file names and uploaders', async () => {
  const { env } = seeded('0007')
  // Accent-free prefix finds "Poročilo Q2.docx" through the rebuilt FTS index.
  assert.deepEqual(ids(await listDocuments(env, { q: 'porocilo' })), ['d2'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'recept.txt' })), ['d5'])
  assert.deepEqual(ids(await listDocuments(env, { q: 'janez.novak' })), ['d3', 'd2'])
  const [doc] = (await listDocuments(env, { q: 'invoice' })).documents
  assert.deepEqual(doc?.source, { filename: 'Invoice_2024_03.pdf', contentType: null, size: 2048, url: '/api/documents/d1/source' })
  assert.equal(doc?.uploadedBy, 'maja.zupan@kaldi.si')
})

test('after 0005, filters by uploader, separately from author', async () => {
  const { env } = seeded('0007')
  assert.deepEqual(ids(await listDocuments(env, { uploadedBy: 'janez.novak@kaldi.si' })), ['d3', 'd2'])
  assert.deepEqual(ids(await listDocuments(env, { uploadedBy: 'janez.novak@kaldi.si', author: 'Maja Župan' })), ['d3'])
  // Before 0005 nobody is recorded as an uploader.
  assert.deepEqual(ids(await listDocuments(seeded('0002').env, { uploadedBy: 'janez.novak@kaldi.si' })), [])
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

test('LIKE wildcards in the query are literal', async () => {
  const { env } = seeded()
  assert.deepEqual(ids(await listDocuments(env, { q: '%' })), [])
  assert.deepEqual(ids(await listDocuments(env, { q: '_' })), ['d1'])
})

test('filters by exact uploader and an inclusive UTC date range', async () => {
  const { env } = seeded()
  assert.deepEqual(ids(await listDocuments(env, { author: 'Maja Župan' })), ['d3', 'd1'])
  assert.deepEqual(ids(await listDocuments(env, { author: 'Maja' })), [])

  const range = parseDocumentListQuery({ from: '2024-05-10', to: '2024-06-01' }).range
  const page = await listDocuments(env, { range })
  assert.deepEqual(ids(page), ['d3', 'd2'])
  assert.equal(page.total, 2)

  const combined = await listDocuments(env, { q: 'maja', range, pageSize: 1 })
  assert.deepEqual(ids(combined), ['d3'])
  assert.equal(combined.total, 1)
})

test('works before migration 0002: LIKE search, no authors', async () => {
  const { env } = seeded('0001')
  assert.deepEqual(ids(await listDocuments(env, { q: 'report' })), ['d2'])
  assert.equal((await listDocuments(env)).documents[0]?.author, null)
  assert.deepEqual(ids(await listDocuments(env, { author: 'Maja Župan' })), [])
  assert.deepEqual(await listDocumentFacets(env), { authors: [], uploaders: [] })
})

test('lists authors and uploaders with document counts, in Slovenian order', async () => {
  const { env, sqlite } = seeded('0007')
  sqlite.prepare("UPDATE documents SET author = 'Črt Zupan' WHERE id = 'd4'").run()
  assert.deepEqual(await listDocumentFacets(env), {
    authors: [
      { name: 'Ana Kovač', count: 1 },
      { name: 'Črt Zupan', count: 1 },
      { name: 'Janez Novak', count: 1 },
      { name: 'Maja Župan', count: 2 }
    ],
    uploaders: [
      { name: 'janez.novak@kaldi.si', count: 2 },
      { name: 'maja.zupan@kaldi.si', count: 1 }
    ]
  })
  assert.deepEqual((await listDocumentFacets(seeded('0002').env)).uploaders, [])
})

test('parses and validates list query parameters', () => {
  const parsed = parseDocumentListQuery({ q: '  maja   župan ', page: '3', pageSize: '50', sort: 'title', from: '2024-01-01' })
  assert.equal(parsed.q, 'maja župan')
  // Decomposed input (c + combining caron) is composed, so it equals stored names.
  assert.equal(parseDocumentListQuery({ author: 'Kovac\u030c' }).author, 'Kovač')
  assert.equal(parsed.page, 3)
  assert.equal(parsed.pageSize, 50)
  assert.equal(parsed.sort, 'title')
  assert.deepEqual(parsed.range, { from: '2024-01-01', toExclusive: null })

  const defaults = parseDocumentListQuery({})
  assert.equal(defaults.page, 1)
  assert.equal(defaults.pageSize, 20)
  assert.equal(defaults.sort, 'newest')

  const status = (query: Record<string, unknown>) => {
    try {
      parseDocumentListQuery(query)
      return 200
    } catch (error) {
      return (error as { statusCode?: number }).statusCode
    }
  }
  assert.equal(status({ page: '0' }), 400)
  assert.equal(status({ page: '1.5' }), 400)
  assert.equal(status({ page: 'abc' }), 400)
  assert.equal(status({ pageSize: '101' }), 400)
  assert.equal(status({ sort: 'random' }), 400)
  assert.equal(status({ from: '2024-02-30' }), 400)
  assert.equal(status({ from: '2024-03-01', to: '2024-02-01' }), 400)
  assert.equal(status({ q: 'x'.repeat(201) }), 400)
})

test('query tokens keep digits so file names split into words', () => {
  assert.deepEqual(queryTokens('Invoice_2024-03.pdf'), ['Invoice', '2024', '03', 'pdf'])
})
