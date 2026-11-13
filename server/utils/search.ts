import { createError } from 'h3'
import { readSearchCapabilities, isMissingSchemaError } from './capabilities'
import type { SearchCapabilities } from './capabilities'
import { embedTexts } from './embeddings'
import type { DocLibraryEnv } from './env'
import { buildFtsMatch, ftsTokens, fuseRankedHits, textHasTokens } from './fts'
import { ensureSchema } from './schema'
import { rankByCosine, useLocalVectors } from './vectors'

const QUERY_MAX = 2000
const FILTER_MAX = 200
// Vectorize allows 50 matches when the query returns metadata.
const VECTOR_FILTER_CANDIDATES = 50
const KEYWORD_CANDIDATES = 20

export interface SearchFilters {
  from?: string | null
  to?: string | null
  title?: string | null
  author?: string | null
}

export interface SearchMatch {
  chunkId: string
  documentId: string
  title: string
  author: string | null
  createdAt: string | null
  chunkIndex: number
  content: string
  score: number
}

export interface SearchResult {
  backend: 'vectorize' | 'd1' | 'hybrid' | 'fts'
  matches: SearchMatch[]
}

interface CreatedAtRange {
  from: string | null
  toExclusive: string | null
}

interface StoredChunkRow {
  id: string
  content: string
  chunk_index: number
  document_id: string
  title: string
  author: string | null
  created_at: string
  embedding?: string | null
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function badRequest (message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

function blank (value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed ? trimmed : null
}

function isCalendarDate (value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

function nextUtcDate (value: string): string {
  const match = ISO_DATE.exec(value)
  if (!match) return value
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  utc.setUTCDate(utc.getUTCDate() + 1)
  return utc.toISOString().slice(0, 10)
}

// Inclusive calendar dates compared to the UTC timestamp in documents.created_at.
export function parseCreatedAtRange (from?: string | null, to?: string | null): CreatedAtRange {
  const start = blank(from)
  const end = blank(to)
  if (start && !isCalendarDate(start)) badRequest('from must be a calendar date (YYYY-MM-DD)')
  if (end && !isCalendarDate(end)) badRequest('to must be a calendar date (YYYY-MM-DD)')
  if (start && end && start > end) badRequest('from must be on or before to')
  return { from: start, toExclusive: end ? nextUtcDate(end) : null }
}

function createdAtSql (range: CreatedAtRange, column: string): { sql: string, params: string[] } {
  const parts: string[] = []
  const params: string[] = []
  if (range.from) {
    parts.push(`${column} >= ?`)
    params.push(range.from)
  }
  if (range.toExclusive) {
    parts.push(`${column} < ?`)
    params.push(range.toExclusive)
  }
  return { sql: parts.length ? ` AND ${parts.join(' AND ')}` : '', params }
}

function passesText (title: string, author: string | null, titleFilter: string, authorFilter: string, caps: SearchCapabilities): boolean {
  const titleTokens = ftsTokens(titleFilter)
  const authorTokens = ftsTokens(authorFilter)
  if (titleTokens.length > 0 && !textHasTokens(title, titleTokens)) return false
  if (authorTokens.length > 0 && caps.author && !textHasTokens(author ?? '', authorTokens)) return false
  return true
}

function toMatch (row: StoredChunkRow, score: number): SearchMatch {
  return {
    chunkId: row.id,
    documentId: row.document_id,
    title: row.title,
    author: row.author ?? null,
    createdAt: row.created_at,
    chunkIndex: row.chunk_index,
    content: row.content,
    score
  }
}

async function queryVectorIndex (env: DocLibraryEnv, vector: number[], topK: number) {
  try {
    return await env.VECTORIZE.query(vector, { topK, returnMetadata: 'all' })
  } catch (error) {
    if (topK <= 20) throw error
    console.error(JSON.stringify({
      message: 'vectorize_query_retry',
      topK,
      error: error instanceof Error ? error.message : String(error)
    }))
    return await env.VECTORIZE.query(vector, { topK: 20, returnMetadata: 'all' })
  }
}

async function hydrateVectorMatches (
  env: DocLibraryEnv,
  matches: Array<{ id: string, score: number, metadata?: Record<string, unknown> }>,
  caps: SearchCapabilities,
  range: CreatedAtRange,
  titleFilter: string,
  authorFilter: string
): Promise<SearchMatch[]> {
  if (matches.length === 0) return []
  const ids = matches.map(match => match.id)
  const placeholders = ids.map(() => '?').join(', ')
  const date = createdAtSql(range, 'd.created_at')
  const authorSql = caps.author ? 'd.author' : 'NULL'
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.content, c.chunk_index, d.id AS document_id, d.title, ${authorSql} AS author, d.created_at
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.id IN (${placeholders})
    ${date.sql}
  `).bind(...ids, ...date.params).all<StoredChunkRow>()
  const byId = new Map(results.map(row => [row.id, row]))
  const ordered: SearchMatch[] = []
  for (const match of matches) {
    const row = byId.get(match.id)
    if (row) {
      if (!passesText(row.title, row.author, titleFilter, authorFilter, caps)) continue
      ordered.push(toMatch(row, match.score))
      continue
    }
    if (range.from || range.toExclusive) continue
    if (ftsTokens(authorFilter).length > 0 && caps.author) continue
    const metadata = match.metadata ?? {}
    const fallback: SearchMatch = {
      chunkId: match.id,
      documentId: String(metadata.documentId || ''),
      title: String(metadata.title || 'Untitled'),
      author: null,
      createdAt: null,
      chunkIndex: Number(metadata.chunkIndex ?? 0),
      content: '',
      score: match.score
    }
    if (!passesText(fallback.title, fallback.author, titleFilter, authorFilter, caps)) continue
    ordered.push(fallback)
  }
  return ordered
}

export async function searchStoredEmbeddings (
  env: DocLibraryEnv,
  vector: number[],
  limit: number,
  caps: SearchCapabilities,
  range: CreatedAtRange,
  titleFilter: string,
  authorFilter: string
): Promise<SearchMatch[]> {
  const date = createdAtSql(range, 'd.created_at')
  const authorSql = caps.author ? 'd.author' : 'NULL'
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.content, c.chunk_index, c.embedding, d.id AS document_id, d.title, ${authorSql} AS author, d.created_at
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE c.embedding IS NOT NULL
    ${date.sql}
    LIMIT 1000
  `).bind(...date.params).all<StoredChunkRow>()

  const parsed = results.flatMap((row) => {
    if (!row.embedding) return []
    if (!passesText(row.title, row.author, titleFilter, authorFilter, caps)) return []
    try {
      const embedding = JSON.parse(row.embedding) as unknown
      if (!Array.isArray(embedding) || embedding.length !== vector.length) return []
      return [{ ...toMatch(row, 0), embedding: embedding as number[] }]
    } catch {
      return []
    }
  })

  return rankByCosine(parsed, vector, limit).map(({ embedding: _embedding, ...match }) => match)
}

async function runVectorSearch (
  env: DocLibraryEnv,
  apiKey: string,
  query: string,
  limit: number,
  broaden: boolean,
  caps: SearchCapabilities,
  range: CreatedAtRange,
  titleFilter: string,
  authorFilter: string
): Promise<{ backend: 'vectorize' | 'd1', matches: SearchMatch[] }> {
  const [vector] = await embedTexts([query], apiKey)
  if (!vector) throw new Error('OpenRouter returned no query embedding')
  const candidateK = broaden ? Math.max(limit, VECTOR_FILTER_CANDIDATES) : limit

  if (!useLocalVectors()) {
    try {
      const result = await queryVectorIndex(env, vector, candidateK)
      const matches = result.matches ?? []
      if (matches.length > 0 || !import.meta.dev) {
        const ordered = await hydrateVectorMatches(env, matches, caps, range, titleFilter, authorFilter)
        return { backend: 'vectorize', matches: ordered }
      }
    } catch (error) {
      if (!import.meta.dev) throw error
      console.error(JSON.stringify({
        message: 'vectorize_query_failed_dev',
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const local = await searchStoredEmbeddings(env, vector, candidateK, caps, range, titleFilter, authorFilter)
  return { backend: 'd1', matches: local }
}

function pickChunk (chunks: StoredChunkRow[], tokens: string[]): StoredChunkRow {
  let best = chunks[0]!
  let bestHits = -1
  for (const chunk of chunks) {
    const folded = chunk.content
    let hits = 0
    for (const token of tokens) {
      if (textHasTokens(folded, [token])) hits += 1
    }
    if (hits > bestHits) {
      best = chunk
      bestHits = hits
    }
  }
  return best
}

async function loadKeywordMatches (
  env: DocLibraryEnv,
  match: string,
  range: CreatedAtRange,
  caps: SearchCapabilities,
  vectorMatches: SearchMatch[],
  tokens: string[]
): Promise<Array<{ key: string, item: SearchMatch }>> {
  if (!caps.fts) return []
  const date = createdAtSql(range, 'd.created_at')
  let documentIds: string[] = []
  try {
    const { results } = await env.DB.prepare(`
      SELECT f.document_id
      FROM documents_fts AS f
      JOIN documents AS d ON d.id = f.document_id
      WHERE documents_fts MATCH ?
      ${date.sql}
      ORDER BY bm25(documents_fts) ASC
      LIMIT ${KEYWORD_CANDIDATES}
    `).bind(match, ...date.params).all<{ document_id: string }>()
    documentIds = results.map(row => row.document_id)
  } catch (error) {
    if (isMissingSchemaError(error)) return []
    throw error
  }
  if (documentIds.length === 0) return []

  const vectorChunkByDocument = new Map<string, SearchMatch>()
  for (const item of vectorMatches) {
    if (!vectorChunkByDocument.has(item.documentId)) vectorChunkByDocument.set(item.documentId, item)
  }

  const missingIds = documentIds.filter(id => !vectorChunkByDocument.has(id))
  const chunksByDocument = new Map<string, StoredChunkRow[]>()
  if (missingIds.length > 0) {
    const placeholders = missingIds.map(() => '?').join(', ')
    const authorSql = caps.author ? 'd.author' : 'NULL'
    const { results } = await env.DB.prepare(`
      SELECT c.id, c.content, c.chunk_index, d.id AS document_id, d.title, ${authorSql} AS author, d.created_at
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.id IN (${placeholders})
      ORDER BY c.chunk_index ASC
    `).bind(...missingIds).all<StoredChunkRow>()
    for (const row of results) {
      const list = chunksByDocument.get(row.document_id) ?? []
      list.push(row)
      chunksByDocument.set(row.document_id, list)
    }
  }

  return documentIds.flatMap((documentId) => {
    const existing = vectorChunkByDocument.get(documentId)
    if (existing) return [{ key: existing.chunkId, item: existing }]
    const chunks = chunksByDocument.get(documentId)
    if (!chunks || chunks.length === 0) return []
    const item = toMatch(pickChunk(chunks, tokens), 0)
    return [{ key: item.chunkId, item }]
  })
}

export async function searchDocuments (
  env: DocLibraryEnv,
  apiKey: string,
  query: string,
  topK: number,
  filters: SearchFilters = {}
): Promise<SearchResult> {
  await ensureSchema(env.DB)
  const trimmed = query.trim()
  const title = (filters.title ?? '').trim()
  const author = (filters.author ?? '').trim()
  if (trimmed.length > QUERY_MAX) badRequest(`Query must be ${QUERY_MAX} characters or fewer`)
  if (title.length > FILTER_MAX) badRequest(`Title filter must be ${FILTER_MAX} characters or fewer`)
  if (author.length > FILTER_MAX) badRequest(`Author filter must be ${FILTER_MAX} characters or fewer`)
  const range = parseCreatedAtRange(filters.from, filters.to)
  if (!trimmed && ftsTokens(title).length === 0 && ftsTokens(author).length === 0) {
    badRequest('Query is required')
  }

  const limit = Math.min(20, Math.max(1, Math.trunc(topK) || 5))
  const caps = await readSearchCapabilities(env.DB)
  const broaden = Boolean(range.from || range.toExclusive || title || author)
  const match = buildFtsMatch([
    { text: trimmed },
    { column: 'title', text: title },
    { column: 'author', text: author }
  ])

  const vectorResult = trimmed
    ? await runVectorSearch(env, apiKey, trimmed, limit, broaden, caps, range, title, author)
    : { backend: 'fts' as const, matches: [] as SearchMatch[] }

  const keywordHits = match
    ? await loadKeywordMatches(env, match, range, caps, vectorResult.matches, ftsTokens(`${trimmed} ${title} ${author}`))
    : []

  const combined = fuseRankedHits(vectorResult.matches, keywordHits, limit, item => item.chunkId)
  let backend: SearchResult['backend']
  if (!combined.fused) backend = trimmed ? vectorResult.backend : 'fts'
  else if (trimmed && vectorResult.matches.length > 0) backend = 'hybrid'
  else backend = 'fts'

  console.log(JSON.stringify({
    message: 'search',
    backend,
    vectors: vectorResult.backend,
    queryChars: trimmed.length,
    keyword: keywordHits.length,
    matches: combined.hits.length,
    hasTitleFilter: Boolean(title),
    hasAuthorFilter: Boolean(author),
    hasDateFilter: Boolean(range.from || range.toExclusive),
    fts: caps.fts
  }))

  return { backend, matches: combined.hits }
}
