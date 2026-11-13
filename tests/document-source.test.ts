import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { EMBEDDING_DIMENSIONS } from '../server/utils/embeddings.ts'
import type { DocDatabase, DocLibraryEnv, R2Bucket } from '../server/utils/env.ts'
import { listDocuments } from '../server/utils/document-list.ts'
import { deleteDocument, getDocument, getDocumentSource, saveDocument } from '../server/utils/documents.ts'
import {
  contentDisposition,
  deleteDocumentObjects,
  markdownKey,
  normalizeSourceFilename,
  sourceContentType,
  sourceKey,
  toSourceFile
} from '../server/utils/document-storage.ts'

const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8')

function openDb (withSource: boolean) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(migration('0001_init.sql'))
  sqlite.exec(migration('0002_document_search.sql'))
  if (withSource) sqlite.exec(migration('0005_document_source.sql'))
  return sqlite
}

function wrap (sqlite: DatabaseSync, failInsert = false): DocDatabase {
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
          return Promise.resolve({ results: statement.all(...(bound as [])) })
        },
        first () {
          return Promise.resolve(statement.get(...(bound as [])) ?? null)
        },
        run () {
          if (failInsert && query.startsWith('INSERT INTO chunks')) return Promise.reject(new Error('D1 is down'))
          statement.run(...(bound as []))
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

interface StoredObject {
  data: Uint8Array
  contentType?: string
  customMetadata?: Record<string, string>
}

function memoryBucket (options: { failPut?: boolean, pageSize?: number } = {}) {
  const objects = new Map<string, StoredObject>()
  const bucket: R2Bucket = {
    async put (key, value, putOptions) {
      if (options.failPut) throw new Error('R2 is down')
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value as ArrayBuffer)
      objects.set(key, { data, contentType: putOptions?.httpMetadata?.contentType, customMetadata: putOptions?.customMetadata })
    },
    async get (key) {
      const object = objects.get(key)
      if (!object) return null
      return { body: new Blob([object.data as Uint8Array<ArrayBuffer>]).stream(), size: object.data.byteLength, httpMetadata: { contentType: object.contentType } }
    },
    async list ({ prefix, cursor }) {
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix)).sort()
      const start = cursor ? Number(cursor) : 0
      const size = options.pageSize ?? 1000
      const page = keys.slice(start, start + size)
      const truncated = start + size < keys.length
      return { objects: page.map(key => ({ key })), truncated, cursor: truncated ? String(start + size) : undefined }
    },
    async delete (keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key)
    }
  }
  return { bucket, objects }
}

function envFor (sqlite: DatabaseSync, bucket?: R2Bucket, failInsert = false): DocLibraryEnv {
  return {
    DB: wrap(sqlite, failInsert),
    BLOB: bucket,
    VECTORIZE: {
      upsert: async () => ({}),
      deleteByIds: async () => ({}),
      query: async () => ({ matches: [] })
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

const pdfBytes = new TextEncoder().encode('%PDF-1.7 fake original')
const pdf = () => toSourceFile({ filename: 'Poročilo Q3.pdf', data: pdfBytes })

test('storage keys keep the original next to the markdown', () => {
  const id = '11111111-2222-4333-8444-555555555555'
  assert.equal(markdownKey(id), `documents/${id}/content.md`)
  assert.equal(sourceKey(id, 'Poročilo Q3.PDF'), `documents/${id}/original.pdf`)
  assert.equal(sourceKey(id, 'README'), `documents/${id}/original`)
})

test('download type comes from the extension, never from the browser', () => {
  assert.equal(sourceContentType('a.pdf'), 'application/pdf')
  assert.equal(sourceContentType('a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(sourceContentType('a.csv'), 'text/csv; charset=utf-8')
  assert.equal(sourceContentType('notes.md'), 'text/markdown; charset=utf-8')
  assert.equal(sourceContentType('page.html'), 'application/octet-stream')
  assert.equal(sourceContentType('noext'), 'application/octet-stream')
})

test('filenames are reduced to a clean basename', () => {
  assert.equal(normalizeSourceFilename('C:\\Users\\maja\\Poročilo.pdf'), 'Poročilo.pdf')
  assert.equal(normalizeSourceFilename('../../etc/passwd'), 'passwd')
  assert.equal(normalizeSourceFilename('a\u0000b\r\n.txt'), 'ab.txt')
  assert.equal(normalizeSourceFilename(''), 'upload')
  assert.equal(normalizeSourceFilename('x'.repeat(300)).length, 255)
})

test('content-disposition keeps UTF-8 names and an ASCII fallback', () => {
  assert.equal(
    contentDisposition('Poročilo "Q3".pdf'),
    'attachment; filename="Poro_ilo _Q3_.pdf"; filename*=UTF-8\'\'Poro%C4%8Dilo%20%22Q3%22.pdf'
  )
})

test('deleting document objects follows list pagination', async () => {
  const { bucket, objects } = memoryBucket({ pageSize: 1 })
  await bucket.put('documents/a/content.md', 'md')
  await bucket.put('documents/a/original.pdf', 'pdf')
  await bucket.put('documents/b/content.md', 'other')
  await bucket.put('documents/a.md', 'legacy')
  await deleteDocumentObjects(bucket, 'a', ['documents/a.md', null])
  assert.deepEqual([...objects.keys()], ['documents/b/content.md'])
})

test('upload stores the original, the markdown, the uploader, and serves the original back', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb(true)
    const { bucket, objects } = memoryBucket()
    const env = envFor(sqlite, bucket)
    const saved = await saveDocument(env, 'test-key', {
      title: 'Poročilo Q3',
      body: '# Poročilo\n\nPrihodki so zrasli.',
      uploadedBy: 'maja@kaldi.si',
      source: pdf()
    })

    assert.equal(saved.uploadedBy, 'maja@kaldi.si')
    assert.equal(saved.r2Key, `documents/${saved.id}/content.md`)
    assert.deepEqual(saved.source, {
      filename: 'Poročilo Q3.pdf',
      contentType: 'application/pdf',
      size: pdfBytes.byteLength,
      url: `/api/documents/${saved.id}/source`
    })
    assert.deepEqual([...objects.keys()].sort(), [`documents/${saved.id}/content.md`, `documents/${saved.id}/original.pdf`])
    const original = objects.get(`documents/${saved.id}/original.pdf`)!
    assert.deepEqual(original.data, pdfBytes)
    assert.equal(original.contentType, 'application/pdf')
    assert.equal(original.customMetadata?.uploadedBy, 'maja@kaldi.si')
    assert.equal(decodeURIComponent(original.customMetadata?.filename ?? ''), 'Poročilo Q3.pdf')

    const document = await getDocument(env, saved.id)
    assert.equal(document.uploadedBy, 'maja@kaldi.si')
    assert.equal(document.createdAt, saved.createdAt)
    assert.equal(document.source?.filename, 'Poročilo Q3.pdf')
    const [listed] = (await listDocuments(env)).documents
    assert.equal(listed?.uploadedBy, 'maja@kaldi.si')
    assert.equal(listed?.source?.size, pdfBytes.byteLength)

    const download = await getDocumentSource(env, saved.id)
    assert.equal(download.filename, 'Poročilo Q3.pdf')
    assert.equal(download.contentType, 'application/pdf')
    assert.deepEqual(new Uint8Array(await new Response(download.body).arrayBuffer()), pdfBytes)

    await deleteDocument(env, saved.id)
    assert.equal(objects.size, 0)
  } finally {
    restore()
  }
})

test('pasted text records the uploader but has no original file', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb(true)
    const { bucket } = memoryBucket()
    const env = envFor(sqlite, bucket)
    const saved = await saveDocument(env, 'test-key', { title: 'Zapisnik', body: 'Sestanek.', uploadedBy: 'ana@kaldi.si' })
    assert.equal(saved.source, null)
    assert.equal((await getDocument(env, saved.id)).uploadedBy, 'ana@kaldi.si')
    await assert.rejects(() => getDocumentSource(env, saved.id), (error: unknown) => (error as { statusCode?: number }).statusCode === 404)
  } finally {
    restore()
  }
})

test('a failed R2 write rejects the upload before anything reaches D1', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb(true)
    const { bucket } = memoryBucket({ failPut: true })
    await assert.rejects(
      () => saveDocument(envFor(sqlite, bucket), 'test-key', { title: 'T', body: 'Body', source: pdf() }),
      (error: unknown) => (error as { statusCode?: number }).statusCode === 502
    )
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents').get()?.n, 0)
  } finally {
    restore()
  }
})

test('a failed D1 write removes the original from R2', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb(true)
    const { bucket, objects } = memoryBucket()
    await assert.rejects(() => saveDocument(envFor(sqlite, bucket, true), 'test-key', { title: 'T', body: 'Body', source: pdf() }))
    assert.equal(objects.size, 0)
    assert.equal(sqlite.prepare('SELECT count(*) AS n FROM documents').get()?.n, 0)
  } finally {
    restore()
  }
})

test('before migration 0005 uploads still work and skip the new columns', async () => {
  const restore = installEmbeddings()
  try {
    const sqlite = openDb(false)
    const { bucket } = memoryBucket()
    const env = envFor(sqlite, bucket)
    const saved = await saveDocument(env, 'test-key', { title: 'T', body: 'Body', uploadedBy: 'maja@kaldi.si', source: pdf() })
    assert.equal(saved.uploadedBy, null)
    const document = await getDocument(env, saved.id)
    assert.equal(document.uploadedBy, null)
    assert.equal(document.source, null)
    assert.equal((await listDocuments(env)).documents[0]?.source, null)
    await assert.rejects(() => getDocumentSource(env, saved.id), (error: unknown) => (error as { statusCode?: number }).statusCode === 404)
    await deleteDocument(env, saved.id)
  } finally {
    restore()
  }
})

test('the source migration only adds nullable columns', () => {
  const sql = migration('0005_document_source.sql')
  for (const column of ['uploaded_by', 'source_key', 'source_filename', 'source_content_type', 'source_size']) {
    assert.match(sql, new RegExp(`ALTER TABLE documents ADD COLUMN ${column} `))
  }
  assert.doesNotMatch(sql, /NOT NULL|DROP/i)
})
