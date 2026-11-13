import { defineQueryOptions } from '@pinia/colada'
import { libraryApiQuery, type LibraryFilters } from '~/utils/libraryFilters'

// The file as it was uploaded, kept in R2 next to the markdown.
export interface DocumentSource {
  filename: string
  contentType: string | null
  size: number | null
  url: string
}

export interface LibraryDocument {
  id: string
  title: string
  author?: string | null
  uploadedBy?: string | null
  createdAt: string
  r2Key: string | null
  source?: DocumentSource | null
  chunkCount: number
}

export interface DocumentPage {
  documents: LibraryDocument[]
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

export interface DocumentDetail {
  id: string
  title: string
  author?: string | null
  uploadedBy?: string | null
  body: string
  createdAt: string
  r2Key: string | null
  source?: DocumentSource | null
  chunks: Array<{ id: string, chunkIndex: number, content: string }>
}

// Hierarchical keys. Invalidating `lists` hits every page and filter combination;
// invalidating `root` hits everything, document bodies included.
export const DOCUMENT_QUERY_KEYS = {
  root: ['documents'] as const,
  lists: ['documents', 'list'] as const,
  list: (filters: LibraryFilters) => [...DOCUMENT_QUERY_KEYS.lists, { ...filters }] as const,
  facets: ['documents', 'facets'] as const,
  byId: (id: string) => [...DOCUMENT_QUERY_KEYS.root, 'detail', id] as const
}

// Every document has its own page. Search results, the Library, uploads, and
// MCP citations all link here.
export function documentPath (id: string): string {
  return `/library/${encodeURIComponent(id)}`
}

// Pass `useRequestFetch()` from setup. During SSR it forwards the visitor's
// cookie and Cloudflare Access header to the API, which plain `$fetch` does not.
// Query functions must not call composables themselves: refetches run outside setup.
type Fetcher = typeof $fetch

export const documentListQuery = defineQueryOptions(({ filters, request }: { filters: LibraryFilters, request: Fetcher }) => ({
  key: DOCUMENT_QUERY_KEYS.list(filters),
  query: ({ signal }) => request<DocumentPage>('/api/documents', { query: libraryApiQuery(filters), signal })
}))

export const documentFacetsQuery = defineQueryOptions((request: Fetcher) => ({
  key: DOCUMENT_QUERY_KEYS.facets,
  // Uploads are rare next to page views; the lists of names can be a minute old.
  staleTime: 60_000,
  query: ({ signal }) => request<DocumentFacets>('/api/documents/facets', { signal })
}))

export const documentByIdQuery = defineQueryOptions(({ id, request }: { id: string, request: Fetcher }) => ({
  key: DOCUMENT_QUERY_KEYS.byId(id),
  query: ({ signal }) => request<DocumentDetail>(`/api/documents/${id}`, { signal })
}))
