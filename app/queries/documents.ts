import { defineQueryOptions } from '@pinia/colada'

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

// Hierarchical keys: invalidating `root` without `exact` also hits every byId entry.
export const DOCUMENT_QUERY_KEYS = {
  root: ['documents'] as const,
  byId: (id: string) => [...DOCUMENT_QUERY_KEYS.root, id] as const
}

// Pass `useRequestFetch()` from setup. During SSR it forwards the visitor's
// cookie and Cloudflare Access header to the API, which plain `$fetch` does not.
// Query functions must not call composables themselves: refetches run outside setup.
type Fetcher = typeof $fetch

export const documentListQuery = defineQueryOptions((request: Fetcher) => ({
  key: DOCUMENT_QUERY_KEYS.root,
  query: async ({ signal }) => {
    const { documents } = await request<{ documents: LibraryDocument[] }>('/api/documents', { signal })
    return documents
  }
}))

export const documentByIdQuery = defineQueryOptions(({ id, request }: { id: string, request: Fetcher }) => ({
  key: DOCUMENT_QUERY_KEYS.byId(id),
  query: ({ signal }) => request<DocumentDetail>(`/api/documents/${id}`, { signal })
}))
