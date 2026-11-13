import { createError } from 'h3'
import { readSearchCapabilities } from './capabilities'
import type { SearchCapabilities } from './capabilities'
import { parseUtcDateRange } from './date-range'
import type { UtcDateRange } from './date-range'
import type { DocLibraryEnv } from './env'
import { quoteFtsToken } from './fts'
import { rowSource, sourceSelect } from './documents'
import { ensureSchema } from './schema'
import { normalizeUnicode } from '../../shared/utils/text'

// Library browsing: one page of documents, filtered and sorted, plus the total
// so the UI can show "21–40 of 132" and numbered pages. Semantic search lives
// in search.ts; this is the plain list.

export const LIST_SORTS = ['newest', 'oldest', 'title'] as const
export type ListSort = typeof LIST_SORTS[number]

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100
const MAX_PAGE = 10_000
const TEXT_MAX = 200
const MAX_QUERY_TOKENS = 8

// Matches the unicode61 tokenizer closely enough: letters and digits, so a
// file title like "invoice_2024_03" yields invoice, 2024, 03.
const TOKEN = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu

export interface DocumentListQuery {
  q: string
  author: string
  uploadedBy: string
  range: UtcDateRange
  sort: ListSort
  page: number
  pageSize: number
}

export interface LibraryDocumentSummary {
  id: string
  title: string
  author: string | null
  uploadedBy: string | null
  // The uploaded original in R2 (migration 0005_document_source.sql).
  source: ReturnType<typeof rowSource>
  createdAt: string
  r2Key: string | null
  chunkCount: number
}

export interface DocumentPage {
  documents: LibraryDocumentSummary[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface FacetValue {
  name: string
  count: number
}

export interface DocumentFacets {
  authors: FacetValue[]
  uploaders: FacetValue[]
}

interface DocumentListRow {
  id: string
  title: string
  author: string | null
  uploaded_by: string | null
  source_key: string | null
  source_filename: string | null
  source_content_type: string | null
  source_size: number | null
  created_at: string
  r2_key: string | null
  chunk_count: number
}

function badRequest (message: string): never {
  throw createError({ statusCode: 400, statusMessage: message, data: { message } })
}

function single (value: unknown): string | undefined {
  if (Array.isArray(value)) return single(value[0])
  if (value === undefined || value === null) return undefined
  return String(value)
}

function text (value: unknown, name: string): string {
  const normalized = normalizeUnicode(single(value) ?? '').trim().replace(/\s+/g, ' ')
  if (normalized.length > TEXT_MAX) badRequest(`${name} must be ${TEXT_MAX} characters or fewer`)
  return normalized
}

function positiveInt (value: unknown, name: string, fallback: number, max: number): number {
  const raw = (single(value) ?? '').trim()
  if (!raw) return fallback
  if (!/^\d+$/.test(raw)) badRequest(`${name} must be a positive whole number`)
  const parsed = Number(raw)
  if (parsed < 1 || parsed > max) badRequest(`${name} must be between 1 and ${max}`)
  return parsed
}

// Strict on purpose: the UI only sends valid values, so anything else is a bug
// or a hand-edited URL and deserves a clear 400 instead of a silent guess.
export function parseDocumentListQuery (query: Record<string, unknown>): DocumentListQuery {
  const sortRaw = (single(query.sort) ?? '').trim() || 'newest'
  if (!(LIST_SORTS as readonly string[]).includes(sortRaw)) badRequest(`sort must be one of ${LIST_SORTS.join(', ')}`)
  return {
    q: text(query.q, 'q'),
    author: text(query.author, 'author'),
    uploadedBy: text(query.uploadedBy, 'uploadedBy'),
    range: parseUtcDateRange(single(query.from), single(query.to)),
    sort: sortRaw as ListSort,
    page: positiveInt(query.page, 'page', 1, MAX_PAGE),
    pageSize: positiveInt(query.pageSize, 'pageSize', DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  }
}

export function queryTokens (q: string): string[] {
  return (q.normalize('NFC').match(TOKEN) ?? []).slice(0, MAX_QUERY_TOKENS)
}

function escapeLike (value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
}

// Each word must appear in the title, author, file name, or uploader email.
// Two ways to match, OR-ed:
// - FTS5 prefix match: "zup" finds "Župan" (diacritics folded), "inv" finds "Invoice".
// - LIKE substring: "port" finds "Report", and it works before migrations 0002/0005/0007.
function textFilter (q: string, caps: SearchCapabilities): { sql: string, params: string[] } | null {
  if (!q) return null
  const tokens = queryTokens(q)
  const words = tokens.length > 0 ? tokens : [q]
  const columns = ['d.title']
  if (caps.author) columns.push('d.author')
  if (caps.source) columns.push('d.source_filename', 'd.uploaded_by')
  const like = words
    .map(() => `(${columns.map(column => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`)
    .join(' AND ')
  const likeParams = words.flatMap((word) => {
    const pattern = `%${escapeLike(word)}%`
    return columns.map(() => pattern)
  })
  if (!caps.fts || tokens.length === 0) {
    return { sql: `(${like})`, params: likeParams }
  }
  // 0007 rebuilt documents_fts with the original file name.
  const ftsColumns = caps.titleSort ? '{title author file_name}' : '{title author}'
  const match = tokens.map(token => `${ftsColumns} : ${quoteFtsToken(token)}*`).join(' AND ')
  return {
    sql: `(d.id IN (SELECT document_id FROM documents_fts WHERE documents_fts MATCH ?) OR (${like}))`,
    params: [match, ...likeParams]
  }
}

function orderBy (sort: ListSort, caps: SearchCapabilities): string {
  if (sort === 'oldest') return 'd.created_at ASC, d.id ASC'
  // title_sort puts Č after C and Ž after Z (see slovenianSortKey). Before
  // migration 0007, NOCASE folds ASCII only and accented initials sort last.
  if (sort === 'title') return `${caps.titleSort ? 'd.title_sort' : 'd.title COLLATE NOCASE'} ASC, d.created_at DESC, d.id DESC`
  return 'd.created_at DESC, d.id DESC'
}

export async function listDocuments (env: DocLibraryEnv, query: Partial<DocumentListQuery> = {}): Promise<DocumentPage> {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const options: DocumentListQuery = {
    q: query.q ?? '',
    author: query.author ?? '',
    uploadedBy: query.uploadedBy ?? '',
    range: query.range ?? { from: null, toExclusive: null },
    sort: query.sort ?? 'newest',
    page: query.page ?? 1,
    pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE
  }
  const empty = (): DocumentPage => ({ documents: [], total: 0, page: options.page, pageSize: options.pageSize, totalPages: 0 })

  const where: string[] = []
  const params: Array<string | number> = []
  const textClause = textFilter(options.q, caps)
  if (textClause) {
    where.push(textClause.sql)
    params.push(...textClause.params)
  }
  if (options.author) {
    // Before migration 0002 no document has an author, so nothing can match.
    if (!caps.author) return empty()
    where.push('d.author = ?')
    params.push(options.author)
  }
  if (options.uploadedBy) {
    if (!caps.source) return empty()
    where.push('d.uploaded_by = ?')
    params.push(options.uploadedBy)
  }
  if (options.range.from) {
    where.push('d.created_at >= ?')
    params.push(options.range.from)
  }
  if (options.range.toExclusive) {
    where.push('d.created_at < ?')
    params.push(options.range.toExclusive)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const authorSelect = caps.author ? 'd.author' : 'NULL AS author'
  const uploadSelect = sourceSelect(caps.source, 'd.')
  const offset = (options.page - 1) * options.pageSize

  // Chunk counts come from a correlated subquery so only the rows on this page
  // touch the chunks index, instead of grouping the whole table.
  const [countRow, pageRows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM documents d ${whereSql}`)
      .bind(...params)
      .first<{ total: number }>(),
    env.DB.prepare(`
      SELECT d.id, d.title, ${authorSelect}, ${uploadSelect}, d.created_at, d.r2_key,
        (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
      FROM documents d
      ${whereSql}
      ORDER BY ${orderBy(options.sort, caps)}
      LIMIT ? OFFSET ?
    `).bind(...params, options.pageSize, offset).all<DocumentListRow>()
  ])

  const total = Number(countRow?.total ?? 0)
  return {
    documents: pageRows.results.map(row => ({
      id: row.id,
      title: row.title,
      author: row.author ?? null,
      uploadedBy: row.uploaded_by ?? null,
      source: rowSource(row),
      createdAt: row.created_at,
      r2Key: row.r2_key,
      chunkCount: Number(row.chunk_count)
    })),
    total,
    page: options.page,
    pageSize: options.pageSize,
    totalPages: Math.ceil(total / options.pageSize)
  }
}

async function facet (env: DocLibraryEnv, column: 'author' | 'uploaded_by'): Promise<FacetValue[]> {
  const { results } = await env.DB.prepare(`
    SELECT ${column} AS name, COUNT(*) AS count
    FROM documents
    WHERE ${column} IS NOT NULL AND ${column} <> ''
    GROUP BY ${column}
  `).all<{ name: string, count: number }>()
  return results
    .map(row => ({ name: row.name, count: Number(row.count) }))
    // In JavaScript, not SQL: localeCompare knows Slovenian order (Č after C).
    .sort((left, right) => left.name.localeCompare(right.name, 'sl', { sensitivity: 'base' }))
}

// Values for the Library's Author and Uploaded by filters, with document counts.
export async function listDocumentFacets (env: DocLibraryEnv): Promise<DocumentFacets> {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)
  const [authors, uploaders] = await Promise.all([
    caps.author ? facet(env, 'author') : [],
    caps.source ? facet(env, 'uploaded_by') : []
  ])
  return { authors, uploaders }
}
