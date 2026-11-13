import type { DocDatabase } from './env'

export interface SearchCapabilities {
  author: boolean
  fts: boolean
}

export function isMissingSchemaError (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)|no such module:\s*fts5/i.test(message)
}

// Detect the 0002 columns without creating them. PR previews share production
// D1 and must keep working before `migrations/0002_document_search.sql` runs.
export async function readSearchCapabilities (db: Pick<DocDatabase, 'prepare'>): Promise<SearchCapabilities> {
  try {
    const info = await db.prepare('PRAGMA table_info(documents)').all<{ name: string }>()
    const author = info.results.some(column => column.name === 'author')
    const tables = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts' LIMIT 1"
    ).all<{ name: string }>()
    return { author, fts: tables.results.length > 0 }
  } catch (error) {
    console.error(JSON.stringify({
      message: 'search_capabilities_unavailable',
      error: error instanceof Error ? error.message : String(error)
    }))
    return { author: false, fts: false }
  }
}
