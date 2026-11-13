import { createError } from 'h3'
import { readSearchCapabilities } from './capabilities'
import { chunkText, ChunkLimitError } from './chunk'
import { embedTexts } from './embeddings'
import { ensureSchema } from './schema'
import { normalizeUnicode, slovenianSortKey } from '../../shared/utils/text'
import { useLocalVectors } from './vectors'
import type { DocLibraryEnv } from './env'

const TITLE_MAX = 200
const AUTHOR_MAX = 200
const BODY_MAX = 200_000
const FILE_NAME_MAX = 255
const FILE_TYPE_MAX = 200
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DocumentRow {
  id: string
  title: string
  author: string | null
  body: string
  r2_key: string | null
  created_at: string
  uploaded_by: string | null
  file_name: string | null
  file_size: number | null
  file_type: string | null
}

export interface UploadedFileInfo {
  name?: unknown
  size?: unknown
  type?: unknown
}

export interface Uploader {
  id: string
  email: string
}

export interface NewDocumentInput {
  title: string
  body: string
  author?: unknown
  // The file the text came from; omitted for pasted text.
  file?: UploadedFileInfo | null
  // The signed-in Cloudflare Access user. Never taken from the request body.
  uploader?: Uploader | null
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

// One space between words, composed Unicode (NFC), so "č" typed on any system
// is stored as the same code point and matches filters exactly.
function cleanLine (value: string): string {
  return normalizeUnicode(value).trim().replace(/\s+/g, ' ')
}

function normalizeAuthor (value: unknown): string | null {
  if (typeof value !== 'string') return null
  const author = cleanLine(value)
  if (!author) return null
  if (author.length > AUTHOR_MAX) badRequest(`Author must be ${AUTHOR_MAX} characters or fewer`)
  return author
}

// Keep only the base name (some browsers send C:\fakepath\…), drop control
// characters, and store it composed: macOS can hand over "č" as c + caron.
export function normalizeFileInfo (file: UploadedFileInfo | null | undefined): { name: string, size: number | null, type: string | null } | null {
  if (!file || typeof file.name !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const name = cleanLine(file.name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, ''))
  if (!name) return null
  if (name.length > FILE_NAME_MAX) badRequest(`File name must be ${FILE_NAME_MAX} characters or fewer`)
  const size = Number(file.size)
  const type = typeof file.type === 'string' ? file.type.trim().toLowerCase().slice(0, FILE_TYPE_MAX) : ''
  return {
    name,
    size: Number.isSafeInteger(size) && size >= 0 ? size : null,
    type: type || null
  }
}

export async function saveDocument (env: DocLibraryEnv, apiKey: string, input: NewDocumentInput) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)

  const title = cleanLine(input.title)
  const author = normalizeAuthor(input.author)
  const file = normalizeFileInfo(input.file)
  const uploader = input.uploader ?? null
  const body = normalizeUnicode(input.body).replace(/\r\n?/g, '\n').trim()
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
    // Write only the columns this database has (see capabilities.ts).
    const columns: Record<string, string | number | null> = { id: documentId, title, body }
    if (caps.author) columns.author = author
    if (caps.uploads) {
      columns.title_sort = slovenianSortKey(title)
      columns.file_name = file?.name ?? null
      columns.file_size = file?.size ?? null
      columns.file_type = file?.type ?? null
      columns.uploaded_by = uploader?.email ?? null
      columns.uploaded_by_id = uploader?.id ?? null
    }
    columns.r2_key = null
    columns.created_at = createdAt
    const names = Object.keys(columns)
    const insert = env.DB.prepare(
      `INSERT INTO documents (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
    ).bind(...Object.values(columns))
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

  console.log(JSON.stringify({
    message: 'document_saved',
    documentId,
    chunkCount: rows.length,
    r2: Boolean(r2Key),
    vectorize,
    hasAuthor: Boolean(author && caps.author),
    hasFile: Boolean(file && caps.uploads),
    hasUploader: Boolean(uploader && caps.uploads)
  }))
  return {
    id: documentId,
    title,
    author: caps.author ? author : null,
    uploadedBy: caps.uploads ? uploader?.email ?? null : null,
    fileName: caps.uploads ? file?.name ?? null : null,
    chunkCount: rows.length,
    r2Key,
    createdAt,
    vectorize
  }
}

export async function getDocument (env: DocLibraryEnv, id: string) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const authorSelect = caps.author ? 'author' : 'NULL AS author'
  const uploadSelect = caps.uploads
    ? 'uploaded_by, file_name, file_size, file_type'
    : 'NULL AS uploaded_by, NULL AS file_name, NULL AS file_size, NULL AS file_type'
  const document = await env.DB.prepare(
    `SELECT id, title, ${authorSelect}, ${uploadSelect}, body, r2_key, created_at FROM documents WHERE id = ?`
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
    uploadedBy: document.uploaded_by ?? null,
    fileName: document.file_name ?? null,
    fileSize: document.file_size ?? null,
    fileType: document.file_type ?? null,
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
