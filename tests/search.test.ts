import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { EMBEDDING_DIMENSIONS } from '../server/utils/embeddings.ts'
import type { DocDatabase, DocLibraryEnv, VectorizeMatch } from '../server/utils/env.ts'
import { saveDocument } from '../server/utils/documents.ts'
import { searchDocuments } from '../server/utils/search.ts'

const initSql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
const searchSql = readFileSync(new URL('../migrations/0002_document_search.sql', import.meta.url), 'utf8')
const laterSql = ['0005_document_source', '0006_document_content_hash', '0007_document_title_sort']
  .map(name => readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), 'utf8'))

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
        all () {
          const results = bound.length ? statement.all(...(bound as [])) : statement.all()
          return Promise.resolve({ results })
        },
        first () {
          const row = bound.length ? statement.get(...(bound as [])) : statement.get()
          return Promise.resolve(row ?? null)
        },
        run () {
          if (bound.length) statement.run(...(bound as []))
          else statement.run()
          return Promise.resolve()
        }
      }
      return api
    },
    batch (statements) {
      return Promise.all(statements.map(statement => statement.run()))
    }
  }
}

function openDb (migration: '0001' | '0002' | '0007') {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(initSql)
  if (migration !== '0001') sqlite.exec(searchSql)
  if (migration === '0007') laterSql.forEach(sql => sqlite.exec(sql))
  return sqlite
}

function insertDocument (sqlite: DatabaseSync, document: {
  id: string
  title: string
  body: string
  author?: string | null
  createdAt: string
  chunkId: string
  withAuthorColumn: boolean
}) {
  if (document.withAuthorColumn) {
    sqlite.prepare(
      'INSERT INTO documents (id, title, body, author, r2_key, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
    ).run(document.id, document.title, document.body, document.author ?? null, document.createdAt)
  } else {
    sqlite.prepare(
      'INSERT INTO documents (id, title, body, r2_key, created_at) VALUES (?, ?, ?, NULL, ?)'
    ).run(document.id, document.title, document.body, document.createdAt)
  }
  sqlite.prepare(
    'INSERT INTO chunks (id, document_id, chunk_index, content, embedding, token_estimate, created_at) VALUES (?, ?, 0, ?, NULL, 1, ?)'
  ).run(document.chunkId, document.id, document.body, document.createdAt)
}

function envFor (sqlite: DatabaseSync, matches: VectorizeMatch[] = [], topKs: number[] = []): DocLibraryEnv {
  return {
    DB: wrap(sqlite),
    VECTORIZE: {
      upsert: async () => ({}),
      deleteByIds: async () => ({}),
      query: async (_vector, options) => {
        topKs.push(options.topK)
        return { matches }
      }
    }
  }
}

function installEmbeddings () {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({
    data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.02) }]
  })
  return () => {
    globalThis.fetch = original
  }
}

test('migration backfill and triggers keep the FTS index in sync', () => {
  const sqlite = openDb('0001')
  sqlite.prepare(
    'INSERT INTO documents (id, title, body, r2_key, created_at) VALUES (?, ?, ?, NULL, ?)'
  ).run('doc-old', 'Čokolada', 'Star recept.', '2023-01-15T08:00:00.000Z')
  sqlite.exec(searchSql)

  const backfill = searchSql.slice(searchSql.lastIndexOf('INSERT INTO documents_fts'))
  sqlite.exec(backfill)
  const matchIds = (expression: string) => sqlite.prepare(
    'SELECT document_id FROM documents_fts WHERE documents_fts MATCH ? ORDER BY document_id'
  ).all(expression).map(row => row.document_id)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents_fts').get()?.n, 1)
  assert.deepEqual(matchIds('cokolada'), ['doc-old'])
  assert.deepEqual(matchIds('čokolada'), ['doc-old'])

  sqlite.prepare(
    'INSERT INTO documents (id, title, body, author, r2_key, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
  ).run('doc-choco', 'Študentski priročnik', 'Recept za štrudelj.', 'Maja Župan', '2024-05-01T08:00:00.000Z')
  assert.deepEqual(matchIds('studentski'), ['doc-choco'])
  assert.deepEqual(matchIds('author : "zupan"'), ['doc-choco'])
  assert.deepEqual(matchIds('štrudelj'), ['doc-choco'])

  sqlite.prepare('UPDATE documents SET title = ?, author = ? WHERE id = ?').run('Popolnoma drug naslov', 'Eva Horvat', 'doc-choco')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents_fts WHERE documents_fts MATCH ?').get('studentski')?.n, 0)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents_fts WHERE documents_fts MATCH ?').get('horvat')?.n, 1)

  sqlite.prepare('DELETE FROM documents WHERE id = ?').run('doc-choco')
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents_fts WHERE document_id = ?').get('doc-choco')?.n, 0)
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents_fts').get()?.n, 1)
})

test('keyword search finds title and author with and without diacritics, and dates narrow it', async () => {
  const sqlite = openDb('0002')
  insertDocument(sqlite, {
    id: 'doc-choco',
    title: 'Čokolada',
    author: 'Maja Župan',
    body: 'Recept za štrudelj.',
    createdAt: '2024-05-01T08:00:00.000Z',
    chunkId: 'chunk-choco',
    withAuthorColumn: true
  })
  insertDocument(sqlite, {
    id: 'doc-meet',
    title: 'Sestanek',
    author: 'Ana Kovač',
    body: 'Tedenski pregled projektov.',
    createdAt: '2024-05-02T08:00:00.000Z',
    chunkId: 'chunk-meet',
    withAuthorColumn: true
  })
  insertDocument(sqlite, {
    id: 'doc-note',
    title: 'Opombe',
    author: 'Eva',
    body: 'Čokolada je omenjena samo v besedilu.',
    createdAt: '2024-05-01T18:00:00.000Z',
    chunkId: 'chunk-note',
    withAuthorColumn: true
  })

  const topKs: number[] = []
  const env = envFor(sqlite, [
    { id: 'chunk-meet', score: 0.99, metadata: { documentId: 'doc-meet', title: 'Sestanek', chunkIndex: 0 } }
  ], topKs)
  const restore = installEmbeddings()
  try {
    const folded = await searchDocuments(env, 'test-key', 'cokolada', 5)
    assert.equal(folded.backend, 'hybrid')
    assert.equal(folded.matches[0]?.documentId, 'doc-choco')
    assert.equal(folded.matches[0]?.author, 'Maja Župan')
    assert.ok(folded.matches.some(match => match.documentId === 'doc-note'))

    const accented = await searchDocuments(env, 'test-key', 'čokolada', 5)
    assert.equal(accented.matches[0]?.documentId, 'doc-choco')

    const author = await searchDocuments(env, 'test-key', '', 5, { author: 'zupan' })
    assert.equal(author.backend, 'fts')
    assert.deepEqual(author.matches.map(match => match.documentId), ['doc-choco'])

    const accentedAuthor = await searchDocuments(env, 'test-key', 'Župan', 5)
    assert.equal(accentedAuthor.matches[0]?.documentId, 'doc-choco')

    const titleOnly = await searchDocuments(env, 'test-key', 'čokolada', 5, { title: 'Čokolada' })
    assert.deepEqual(titleOnly.matches.map(match => match.documentId), ['doc-choco'])

    const mayFirst = await searchDocuments(env, 'test-key', 'cokolada', 5, { from: '2024-05-01', to: '2024-05-01' })
    assert.ok(mayFirst.matches.every(match => match.documentId !== 'doc-meet'))
    assert.ok(mayFirst.matches.some(match => match.documentId === 'doc-choco'))

    const maySecond = await searchDocuments(env, 'test-key', 'cokolada', 5, { from: '2024-05-02', to: '2024-05-02' })
    assert.ok(maySecond.matches.every(match => match.documentId !== 'doc-choco'))
    assert.deepEqual(maySecond.matches.map(match => match.documentId), ['doc-meet'])
    assert.ok(topKs.some(topK => topK === 50))
  } finally {
    restore()
  }
})

test('saving stores composed Unicode and a Slovenian title sort key', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb('0007')
    const saved = await saveDocument(envFor(sqlite), 'test-key', {
      // Decomposed č and š, as macOS can send them.
      title: '  Poroc\u030Cilo   Q2 ',
      author: 'Ana Kovac\u030C',
      body: 'S\u030Cola.\r\nVrstica.',
      uploadedBy: 'ana.kovac@kaldi.si'
    })
    const row = sqlite.prepare('SELECT * FROM documents WHERE id = ?').get(saved.id) as Record<string, unknown>
    assert.equal(row.title, 'Poročilo Q2')
    assert.equal(row.author, 'Ana Kovač')
    assert.equal(row.body, 'Šola.\nVrstica.')
    assert.equal(row.title_sort, 'poroc{ilo q2')
    assert.equal(row.uploaded_by, 'ana.kovac@kaldi.si')

    // Before 0007 the same save works and skips title_sort.
    const older = openDb('0002')
    const plain = await saveDocument(envFor(older), 'test-key', { title: 'Star', body: 'Besedilo.' })
    assert.equal(older.prepare("SELECT count(*) AS n FROM pragma_table_info('documents') WHERE name = 'title_sort'").get()?.n, 0)
    assert.ok(plain.id)
  } finally {
    restore()
  }
})
