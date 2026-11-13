import { createError } from 'h3'
import { readSearchCapabilities } from './capabilities'
import { chunkText, ChunkLimitError } from './chunk'
import { deleteDocumentObjects, markdownKey, sourceKey, type SourceFile } from './document-storage'
import { contentHash, duplicateCheckEnabled, duplicateError, findDuplicate, hasContentHashColumn } from './duplicates'
import { embedTexts } from './embeddings'
import { ensureSchema } from './schema'
import { normalizeUnicode, slovenianSortKey } from '../../shared/utils/text'
import { useLocalVectors } from './vectors'
import type { DocLibraryEnv } from './env'

const TITLE_MAX = 200
const AUTHOR_MAX = 200
const BODY_MAX = 200_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SourceColumns {
  uploaded_by: string | null
  source_key: string | null
  source_filename: string | null
  source_content_type: string | null
  source_size: number | null
}

interface DocumentRow extends SourceColumns {
  id: string
  title: string
  author: string | null
  body: string
  r2_key: string | null
  created_at: string
}

export const SOURCE_COLUMNS = ['uploaded_by', 'source_key', 'source_filename', 'source_content_type', 'source_size'] as const

// Before migration 0005 the columns do not exist, so select NULLs under the same names.
export function sourceSelect (enabled: boolean, alias = ''): string {
  return SOURCE_COLUMNS.map(column => enabled ? `${alias}${column}` : `NULL AS ${column}`).join(', ')
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

// One space between words and composed Unicode (NFC), so a "č" typed or pasted
// on any system is stored as the same code point and matches filters exactly.
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

export interface SaveDocumentInput {
  title: string
  body: string
  author?: unknown
  // Verified identity of the uploader (Cloudflare Access email). Never read from the request body.
  uploadedBy?: string | null
  // The uploaded file before conversion. Kept in R2 next to the markdown.
  source?: SourceFile | null
}

function logStorageError (message: string, documentId: string, error: unknown) {
  console.error(JSON.stringify({ message, documentId, error: error instanceof Error ? error.message : String(error) }))
}

export async function saveDocument (env: DocLibraryEnv, apiKey: string, input: SaveDocumentInput) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)

  const title = cleanLine(input.title)
  const author = normalizeAuthor(input.author)
  const uploadedBy = input.uploadedBy?.trim() || null
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

  // Before embeddings, so a duplicate costs no OpenRouter call.
  const hash = await hasContentHashColumn(env.DB) ? await contentHash(body) : null
  if (hash && duplicateCheckEnabled(env.DUPLICATE_CHECK, process.env.DUPLICATE_CHECK)) {
    const duplicate = await findDuplicate(env.DB, hash)
    if (duplicate) {
      console.log(JSON.stringify({ message: 'document_duplicate_rejected', existingId: duplicate.id }))
      throw duplicateError(duplicate)
    }
  }

  const embeddings = await embedTexts(chunks, apiKey)
  const documentId = crypto.randomUUID()
  const createdAt = new Date().toISOString()
  const rows = chunks.map((content, index) => ({
    id: crypto.randomUUID(),
    content,
    index,
    tokenEstimate: Math.ceil(content.length / 4)
  }))

  // The original file is the reference copy, so it is stored before anything else.
  // If R2 rejects it the upload fails and nothing is left behind in D1 or Vectorize.
  const source = input.source && env.BLOB ? input.source : null
  const storedSourceKey = source ? sourceKey(documentId, source.filename) : null
  if (source && storedSourceKey) {
    try {
      await env.BLOB!.put(storedSourceKey, source.data, {
        httpMetadata: { contentType: source.contentType },
        customMetadata: {
          documentId,
          filename: encodeURIComponent(source.filename),
          uploadedAt: createdAt,
          ...(uploadedBy ? { uploadedBy } : {})
        }
      })
    } catch (error) {
      logStorageError('r2_source_put_failed', documentId, error)
      throw createError({
        statusCode: 502,
        statusMessage: 'Could not store the original file',
        data: { message: `Could not store ${source.filename} in R2. Nothing was saved.` }
      })
    }
  } else if (input.source) {
    console.error(JSON.stringify({ message: 'r2_source_skipped_no_binding', documentId }))
  }

  const rollback = async () => {
    await env.DB.prepare('DELETE FROM chunks WHERE document_id = ?').bind(documentId).run()
    await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(documentId).run()
    if (env.BLOB && storedSourceKey) {
      try {
        await deleteDocumentObjects(env.BLOB, documentId)
      } catch (error) {
        logStorageError('r2_rollback_failed', documentId, error)
      }
    }
  }

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

  // Only write columns that exist: PR previews share production D1 before migrations run.
  const columns: Record<string, unknown> = { id: documentId, title, body, r2_key: null, created_at: createdAt }
  if (caps.author) columns.author = author
  if (caps.source) {
    columns.uploaded_by = uploadedBy
    columns.source_key = storedSourceKey
    columns.source_filename = source?.filename ?? null
    columns.source_content_type = source?.contentType ?? null
    columns.source_size = source?.data.byteLength ?? null
  }
  if (hash) columns.content_hash = hash
  // Sorts Č after C and Ž after Z in the Library (see slovenianSortKey).
  if (caps.titleSort) columns.title_sort = slovenianSortKey(title)
  const names = Object.keys(columns)

  try {
    const insert = env.DB.prepare(
      `INSERT INTO documents (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
    ).bind(...Object.values(columns))
    await env.DB.batch([insert])
    for (let offset = 0; offset < chunkInserts.length; offset += 4) {
      await env.DB.batch(chunkInserts.slice(offset, offset + 4))
    }
  } catch (error) {
    await rollback()
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
        await rollback()
        console.error(JSON.stringify({ message: 'vectorize_upsert_failed', documentId, error: message }))
        throw createError({ statusCode: 502, statusMessage: 'Vectorize upsert failed', data: { message } })
      }
      vectorize = 'failed'
      console.error(JSON.stringify({ message: 'vectorize_upsert_failed_dev', documentId, error: message }))
    }
  }

  // The markdown copy is a convenience (D1 already holds the body), so a failure only logs.
  let r2Key: string | null = null
  if (env.BLOB) {
    const key = markdownKey(documentId)
    try {
      await env.BLOB.put(key, body, {
        httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
        customMetadata: { documentId, title: encodeURIComponent(title) }
      })
      r2Key = key
      await env.DB.prepare('UPDATE documents SET r2_key = ? WHERE id = ?').bind(key, documentId).run()
    } catch (error) {
      logStorageError('r2_put_failed', documentId, error)
    }
  }

  console.log(JSON.stringify({
    message: 'document_saved',
    documentId,
    chunkCount: rows.length,
    r2: Boolean(r2Key),
    source: Boolean(storedSourceKey),
    vectorize,
    hasAuthor: Boolean(author && caps.author),
    hasUploader: Boolean(uploadedBy && caps.source)
  }))
  return {
    id: documentId,
    title,
    author: caps.author ? author : null,
    uploadedBy: caps.source ? uploadedBy : null,
    chunkCount: rows.length,
    r2Key,
    source: storedSourceKey && source
      ? sourceView(documentId, { filename: source.filename, contentType: source.contentType, size: source.data.byteLength })
      : null,
    createdAt,
    vectorize
  }
}

function sourceView (documentId: string, source: { filename: string, contentType: string | null, size: number | null }) {
  return {
    filename: source.filename,
    contentType: source.contentType,
    size: source.size,
    url: `/api/documents/${documentId}/source`
  }
}

export function rowSource (row: { id: string, source_key?: string | null, source_filename?: string | null, source_content_type?: string | null, source_size?: number | null }) {
  if (!row.source_key || !row.source_filename) return null
  return sourceView(row.id, {
    filename: row.source_filename,
    contentType: row.source_content_type ?? null,
    size: row.source_size == null ? null : Number(row.source_size)
  })
}

export async function getDocument (env: DocLibraryEnv, id: string) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const authorSelect = caps.author ? 'author' : 'NULL'
  const document = await env.DB.prepare(
    `SELECT id, title, ${authorSelect} AS author, body, r2_key, created_at, ${sourceSelect(caps.source)} FROM documents WHERE id = ?`
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
    body: document.body,
    r2Key: document.r2_key,
    source: rowSource(document),
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
  if (env.BLOB) {
    try {
      // Removes the original file and the markdown copy under documents/<id>/.
      await deleteDocumentObjects(env.BLOB, id, [existing.r2_key])
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

export async function getDocumentSource (env: DocLibraryEnv, id: string) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const notFound = (message: string) => createError({ statusCode: 404, statusMessage: message, data: { message } })
  if (!caps.source) throw notFound('Original files are not available yet')
  const row = await env.DB.prepare(
    'SELECT source_key, source_filename, source_content_type FROM documents WHERE id = ?'
  ).bind(id).first<Pick<SourceColumns, 'source_key' | 'source_filename' | 'source_content_type'>>()
  if (!row) throw notFound('Document not found')
  if (!row.source_key || !row.source_filename) throw notFound('This document has no original file')
  if (!env.BLOB) {
    throw createError({ statusCode: 503, statusMessage: 'R2 binding is unavailable', data: { message: 'The BLOB binding is missing.' } })
  }
  const object = await env.BLOB.get(row.source_key)
  if (!object) throw notFound('The original file is missing from storage')
  return {
    body: object.body,
    size: object.size,
    filename: row.source_filename,
    contentType: row.source_content_type || 'application/octet-stream'
  }
}
