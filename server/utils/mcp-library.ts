import { getDocument, searchDocuments } from './documents.ts'
import type { DocLibraryEnv } from './env.ts'

// feature/metadata-search-date-filter (#6) moves searchDocuments to
// server/utils/search.ts and adds this filters argument. The extra argument is
// ignored on current main. After rebasing, point this import at the new module
// if the export moves. The call shape already matches.
interface SearchFilters {
  from?: string
  to?: string
  author?: string
}

type SearchFn = (
  env: DocLibraryEnv,
  apiKey: string,
  query: string,
  topK: number,
  filters?: SearchFilters
) => Promise<{ matches: Array<{ documentId: string, title: string, author?: string | null, createdAt?: string | null }> }>

const search = searchDocuments as SearchFn

async function slackReady (env: unknown): Promise<boolean> {
  const db = (env as DocLibraryEnv | undefined)?.DB
  if (!db) return false
  try {
    const { results } = await db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'slack_messages' LIMIT 1"
    ).all<{ ok: number }>()
    return results.length > 0
  } catch {
    return false
  }
}

// feature/slack-archive (#7) exports searchSlackMessages from
// server/utils/slack-search.ts. That file is not on main, so this stays null
// and search_slack is omitted. After rebase, replace null with:
//   import { searchSlackMessages } from './slack-search.ts'
//   slackSearch: (env, input) => searchSlackMessages((env as DocLibraryEnv).DB, input)
export const defaultLibrary = {
  searchDocuments: (env: unknown, apiKey: string, query: string, topK: number, filters?: SearchFilters) => {
    return search(env as DocLibraryEnv, apiKey, query, topK, filters)
  },
  getDocument: (env: unknown, id: string) => getDocument(env as DocLibraryEnv, id),
  slackSearch: null,
  slackReady
}
