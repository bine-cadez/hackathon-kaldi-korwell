import { useMutation, useQueryCache } from '@pinia/colada'
import { DOCUMENT_QUERY_KEYS, type LibraryDocument } from '~/queries/documents'

export interface NewDocument {
  title: string
  author: string
  body: string
}

export interface SavedDocument {
  id: string
  title: string
  chunkCount: number
  r2Key: string | null
}

export function useSaveDocumentMutation () {
  const queryCache = useQueryCache()
  return useMutation({
    // JSON for pasted text; FormData when a PDF, Word, Excel, or CSV file is converted on the server.
    mutation: (input: NewDocument | FormData) => $fetch<SavedDocument>('/api/documents', { method: 'POST', body: input }),
    // Only the list changes; existing document entries stay valid.
    onSettled: () => queryCache.invalidateQueries({ key: DOCUMENT_QUERY_KEYS.root, exact: true })
  })
}

// Optimistic update through the cache, following the Pinia Colada recipe:
// https://pinia-colada.esm.dev/guide/optimistic-updates.html
export function useDeleteDocumentMutation () {
  const queryCache = useQueryCache()
  return useMutation({
    onMutate (id: string) {
      const previous = queryCache.getQueryData<LibraryDocument[]>(DOCUMENT_QUERY_KEYS.root)
      const optimistic = previous?.filter(document => document.id !== id)
      if (optimistic) queryCache.setQueryData(DOCUMENT_QUERY_KEYS.root, optimistic)
      // Stop an in-flight list fetch from putting the row back.
      queryCache.cancelQueries({ key: DOCUMENT_QUERY_KEYS.root, exact: true })
      return { previous, optimistic }
    },
    // Explicit type arguments keep Nitro's typed-route inference from recursing too deep.
    mutation: (id: string) => $fetch<unknown, string>(`/api/documents/${id}`, { method: 'DELETE' }),
    onError (_error, _id, { previous, optimistic }) {
      // Roll back only if nothing else has updated the list since.
      if (previous && optimistic === queryCache.getQueryData(DOCUMENT_QUERY_KEYS.root)) {
        queryCache.setQueryData(DOCUMENT_QUERY_KEYS.root, previous)
      }
    },
    onSettled: () => queryCache.invalidateQueries({ key: DOCUMENT_QUERY_KEYS.root, exact: true })
  })
}
