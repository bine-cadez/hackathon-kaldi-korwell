import { getDocument } from './documents.ts'
import type { DocLibraryEnv } from './env.ts'
import { searchDocuments, type SearchFilters } from './search.ts'
import { searchSlackMessages } from './slack-search.ts'
import { slackArchiveReady } from './slack-store.ts'

async function slackReady (env: unknown): Promise<boolean> {
  const db = (env as DocLibraryEnv | undefined)?.DB
  if (!db) return false
  try {
    return await slackArchiveReady(db)
  } catch {
    return false
  }
}

export const defaultLibrary = {
  searchDocuments: (env: unknown, apiKey: string, query: string, topK: number, filters?: SearchFilters) => {
    return searchDocuments(env as DocLibraryEnv, apiKey, query, topK, filters)
  },
  getDocument: (env: unknown, id: string) => getDocument(env as DocLibraryEnv, id),
  slackSearch: (env: unknown, input: Parameters<typeof searchSlackMessages>[1]) => searchSlackMessages((env as DocLibraryEnv).DB, input),
  slackReady
}
