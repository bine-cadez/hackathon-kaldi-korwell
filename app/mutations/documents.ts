import { useMutation, useQueryCache, type EntryKey } from '@pinia/colada'
import { DOCUMENT_QUERY_KEYS, type DocumentPage } from '~/queries/documents'

export interface NewDocument {
  title: string
  author: string
  body: string
  // The text file the body was read from, if any.
  file?: { name: string, size: number, type: string }
}

export interface SavedDocument {
  id: string
  title: string
  chunkCount: number
  r2Key: string | null
  wordCount: number
}

function invalidateLists (queryCache: ReturnType<typeof useQueryCache>) {
  // Every cached page can shift, and the author and uploader counts change.
  return Promise.all([
    queryCache.invalidateQueries({ key: DOCUMENT_QUERY_KEYS.lists }),
    queryCache.invalidateQueries({ key: DOCUMENT_QUERY_KEYS.facets, exact: true })
  ])
}

export function useSaveDocumentMutation () {
  const queryCache = useQueryCache()
  return useMutation({
    // JSON for pasted text; FormData when a PDF, Word, Excel, or CSV file is converted on the server.
    mutation: (input: NewDocument | FormData) => $fetch<SavedDocument>('/api/documents', { method: 'POST', body: input }),
    // Only the lists change; existing document entries stay valid.
    onSettled: () => invalidateLists(queryCache)
  })
}

function withoutDocument (page: DocumentPage, id: string): DocumentPage {
  if (!page.documents.some(document => document.id === id)) return page
  const total = Math.max(0, page.total - 1)
  return {
    ...page,
    documents: page.documents.filter(document => document.id !== id),
    total,
    totalPages: Math.ceil(total / page.pageSize)
  }
}

interface PageSnapshot {
  key: EntryKey
  previous: DocumentPage
  optimistic: DocumentPage
}

// Optimistic update through the cache, following the Pinia Colada recipe:
// https://pinia-colada.esm.dev/guide/optimistic-updates.html
// The row leaves every cached page that shows it, not just the visible one.
export function useDeleteDocumentMutation () {
  const queryCache = useQueryCache()
  return useMutation({
    onMutate (id: string) {
      const snapshots: PageSnapshot[] = []
      for (const entry of queryCache.getEntries({ key: DOCUMENT_QUERY_KEYS.lists })) {
        const previous = entry.state.value.data as DocumentPage | undefined
        if (!previous) continue
        const optimistic = withoutDocument(previous, id)
        if (optimistic === previous) continue
        queryCache.setQueryData(entry.key, optimistic)
        snapshots.push({ key: entry.key, previous, optimistic })
      }
      // Stop in-flight list fetches from putting the row back.
      queryCache.cancelQueries({ key: DOCUMENT_QUERY_KEYS.lists })
      return { snapshots }
    },
    // Explicit type arguments keep Nitro's typed-route inference from recursing too deep.
    mutation: (id: string) => $fetch<unknown, string>(`/api/documents/${id}`, { method: 'DELETE' }),
    onError (_error, _id, { snapshots }) {
      // Roll back only the pages nothing else has updated since.
      for (const { key, previous, optimistic } of snapshots ?? []) {
        if (queryCache.getQueryData(key) === optimistic) queryCache.setQueryData(key, previous)
      }
    },
    onSuccess (_data, id) {
      // A deleted document's page must not come back from the cache via Back.
      for (const entry of queryCache.getEntries({ key: DOCUMENT_QUERY_KEYS.byId(id), exact: true })) queryCache.remove(entry)
    },
    onSettled: () => invalidateLists(queryCache)
  })
}
