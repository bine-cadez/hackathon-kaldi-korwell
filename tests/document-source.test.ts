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
  normalizeSourceFilename,
  sourceContentType,
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

test('download type comes from the extension, never from the browser', () => {
  assert.equal(sourceContentType('a.pdf'), 'application/pdf')
  assert.equal(sourceContentType('a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  assert.equal(sourceContentType('a.csv'), 'text/csv; charset=utf-8')
  assert.equal(sourceContentType('notes.md'), 'text/markdown; charset=utf-8')
  assert.equal(sourceContentType('page.html'), 'application/octet-stream')
  assert.equal(sourceContentType('noext'), 'application/octet-stream')
})

test('only PDFs are ever served inline for preview', () => {
  // Text uploads accept any extension, so an .html or .svg original must stay a download.
  assert.match(contentDisposition('Poročilo.pdf', { inline: true }), /^inline;/)
  for (const name of ['page.html', 'logo.svg', 'notes.md', 'a.csv', 'a.xlsx', 'x.pdf.html']) {
    assert.match(contentDisposition(name, { inline: true }), /^attachment;/, name)
  }
  assert.match(contentDisposition('Poročilo.pdf'), /^attachment;/)
})

test('filenames are reduced to a clean basename', () => {
  assert.equal(normalizeSourceFilename('C:\\Users\\maja\\Poročilo.pdf'), 'Poročilo.pdf')
  assert.equal(normalizeSourceFilename('../../etc/passwd'), 'passwd')
  assert.equal(normalizeSourceFilename('a\u0000b\r\n.txt'), 'ab.txt')
  assert.equal(normalizeSourceFilename(''), 'upload')
  assert.equal(normalizeSourceFilename('x'.repeat(300)).length, 255)
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
