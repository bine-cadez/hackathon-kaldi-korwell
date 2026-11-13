import { createError } from 'h3'
import { readSearchCapabilities } from './capabilities'
import { chunkText, ChunkLimitError } from './chunk'
import { embedTexts } from './embeddings'
import { ensureSchema } from './schema'
import { useLocalVectors } from './vectors'
import type { DocLibraryEnv } from './env'

const TITLE_MAX = 200
const AUTHOR_MAX = 200
const BODY_MAX = 200_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DocumentListRow {
  id: string
  title: string
  author: string | null
  created_at: string
  r2_key: string | null
  chunk_count: number
}

interface DocumentRow {
  id: string
  title: string
  author: string | null
  body: string
  r2_key: string | null
  created_at: string
}

interface ChunkRow {
  id: string
  chunk_index: number
  content: string
  document_id?: string
  title?: string
}

function badRequest (message: string) {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

export function assertDocumentId (id: string | undefined): string {
  if (!id || !UUID_PATTERN.test(id)) badRequest('Document id must be a UUID')
  return id
}

function normalizeAuthor (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const author = value.trim().replace(/\s+/g, ' ')
  if (!author) return null
  if (author.length > AUTHOR_MAX) badRequest(`Author must be ${AUTHOR_MAX} characters or fewer`)
  return author
}

export async function saveDocument (env: DocLibraryEnv, apiKey: string, input: { title: string, body: string, author?: unknown }) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)

  const title = input.title.trim().replace(/\s+/g, ' ')
  const author = normalizeAuthor(input.author)
  const body = input.body.replace(/\r\n/g, '\n').trim()
  if (!title) badRequest('Title is required')
  if (title.length > TITLE_MAX) badRequest(`Title must be ${TITLE_MAX} characters or fewer`)
  if (!body) badRequest('Document body is required')
  if (body.length > BODY_MAX) badRequest(`Body must be ${BODY_MAX} characters or fewer`)

  let chunks: string[]
  try {
    chunks = chunkText(body)
  } catch (error) {
    if (error instanceof ChunkLimitError) {
      throw createError({ statusCode: 413, statusMessage: error.message, data: { message: error.message } })
    }
    throw error
  }
  if (chunks.length === 0) badRequest('Document body is empty')

  const embeddings = await embedTexts(chunks, apiKey)
  const documentId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const rows = chunks.map((content, index) => ({
    id: crypto.randomUUID(),
    content,
    index,
    tokenEstimate: Math.ceil(content.length / 4)
  }))

  const chunkInserts = rows.map(row => env.DB.prepare(
    'INSERT INTO chunks (id, document_id, chunk_index, content, embedding, token_estimate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    row.id,
    documentId,
    row.index,
    row.content,
    JSON.stringify(embeddings[row.index]),
    row.tokenEstimate,
    createdAt
  ))

  try {
    const insert = caps.author
      ? env.DB.prepare(
        'INSERT INTO documents (id, title, body, author, r2_key, created_at) VALUES (?, ?, ?, ?, NULL, ?)'
      ).bind(documentId, title, body, author, createdAt)
      : env.DB.prepare(
        'INSERT INTO documents (id, title, body, r2_key, created_at) VALUES (?, ?, ?, NULL, ?)'
      ).bind(documentId, title, body, createdAt)
    await env.DB.batch([insert])
    for (let offset = 0; offset < chunkInserts.length; offset += 4) {
      await env.DB.batch(chunkInserts.slice(offset, offset + 4))
    }
  } catch (error) {
    await env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(documentId).run()
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(documentId).run()
    throw error
  }

  let vectorize: 'skipped' | 'upserted' | 'failed' = useLocalVectors() ? 'skipped' : 'upserted'
  if (!useLocalVectors()) {
    try {
      await env.VECTORIZE.upsert(rows.map(row => ({
        id: row.id,
        values: embeddings[row.index]!,
        metadata: {
          documentId,
          title,
          chunkIndex: row.index
        }
      })))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Vectorize upsert failed'
      if (!import.meta.dev) {
        await env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(documentId).run()
        await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(documentId).run()
        console.error(JSON.stringify({ message: 'vectorize_upsert_failed', documentId, error: message }))
        throw createError({ statusCode: 502, statusMessage: 'Vectorize upsert failed', data: { message } })
      }
      vectorize = 'failed'
      console.error(JSON.stringify({ message: 'vectorize_upsert_failed_dev', documentId, error: message }))
    }
  }

  let r2Key: string | null = null
  if (env.BLOB) {
    const key = `documents/${documentId}.md`
    try {
      await env.BLOB.put(key, body, {
        httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
        customMetadata: { documentId, title }
      })
      r2Key = key
      await env.DB.prepare('UPDATE documents SET r2_key = ? WHERE id = ?').bind(key, documentId).run()
    } catch (error) {
      console.error(JSON.stringify({
        message: 'r2_put_failed',
        documentId,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  console.log(JSON.stringify({ message: 'document_saved', documentId, chunkCount: rows.length, r2: Boolean(r2Key), vectorize, hasAuthor: Boolean(author && caps.author) }))
  return {
    id: documentId,
    title,
    author: caps.author ? author : null,
    chunkCount: rows.length,
    r2Key,
    createdAt,
    vectorize
  }
}

export async function listDocuments (env: DocLibraryEnv) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const authorSelect = caps.author ? 'd.author' : 'NULL'
  const authorGroup = caps.author ? 'd.author, ' : ''
  const { results } = await env.DB.prepare(`
    SELECT d.id, d.title, ${authorSelect} AS author, d.created_at, d.r2_key, COUNT(c.id) AS chunk_count
    FROM documents d
    LEFT JOIN chunks c ON c.document_id = d.id
    GROUP BY d.id, d.title, ${authorGroup}d.created_at, d.r2_key
    ORDER BY d.created_at DESC
    LIMIT 100
  `).all<DocumentListRow>()

  return results.map(row => ({
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    createdAt: row.created_at,
    r2Key: row.r2_key,
    chunkCount: Number(row.chunk_count)
  }))
}

export async function getDocument (env: DocLibraryEnv, id: string) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const authorSelect = caps.author ? 'author' : 'NULL'
  const document = await env.DB.prepare(
    `SELECT id, title, ${authorSelect} AS author, body, r2_key, created_at FROM documents WHERE id = ?`
  ).bind(id).first<DocumentRow>()
  if (!document) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found', data: { message: 'Document not found' } })
  }
  const { results } = await env.DB.prepare(
    'SELECT id, chunk_index, content FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC'
  ).bind(id).all<ChunkRow>()

  return {
    id: document.id,
    title: document.title,
    author: document.author ?? null,
    body: document.body,
    r2Key: document.r2_key,
    createdAt: document.created_at,
    chunks: results.map(chunk => ({
      id: chunk.id,
      chunkIndex: chunk.chunk_index,
      content: chunk.content
    }))
  }
}

export async function deleteDocument (env: DocLibraryEnv, id: string) {
  await ensureSchema(env.DB)
  const existing = await env.DB.prepare('SELECT id, r2_key FROM documents WHERE id = ?').bind(id).first<{ id: string, r2_key: string | null }>()
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found', data: { message: 'Document not found' } })
  }

  const { results } = await env.DB.prepare('SELECT id FROM chunks WHERE document_id = ?').bind(id).all<{ id: string }>()
  const chunkIds = results.map(row => row.id)
  if (chunkIds.length > 0 && !useLocalVectors()) {
    try {
      await env.VECTORIZE.deleteByIds(chunkIds)
    } catch (error) {
      if (!import.meta.dev) throw error
      console.error(JSON.stringify({
        message: 'vectorize_delete_failed_dev',
        documentId: id,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }
  await env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(id).run()
  await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run()
  if (existing.r2_key && env.BLOB) {
    try {
      await env.BLOB.delete(existing.r2_key)
    } catch (error) {
      console.error(JSON.stringify({
        message: 'r2_delete_failed',
        documentId: id,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }
  console.log(JSON.stringify({ message: 'document_deleted', documentId: id, chunkCount: chunkIds.length }))
  return { id, deleted: true }
}
