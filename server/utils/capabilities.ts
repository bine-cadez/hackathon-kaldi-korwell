import type { DocDatabase } from './env'

export interface SearchCapabilities {
  author: boolean
  fts: boolean
  // migrations/0005_document_source.sql: uploaded_by and source_* columns.
  source: boolean
  // migrations/0007_document_title_sort.sql: title_sort, and source_filename in documents_fts.
  titleSort: boolean
}

export function isMissingSchemaError (error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /no such (table|column)|no such module:\s*fts5/i.test(message)
}

type CapabilityDb = Pick<DocDatabase, 'prepare'>

// Migrations only add capabilities, so a fully migrated database is cached for
// the life of the Worker isolate. Anything less is re-checked on each request,
// so applying a migration takes effect without a redeploy.
const fullyMigrated = new WeakSet<CapabilityDb>()

// Detect the 0002, 0005, and 0007 columns without creating them. PR previews share
// production D1 and must keep working before those migrations run.
export async function readSearchCapabilities (db: CapabilityDb): Promise<SearchCapabilities> {
  if (fullyMigrated.has(db)) return { author: true, fts: true, source: true, titleSort: true }
  try {
    const [info, tables] = await Promise.all([
      db.prepare('PRAGMA table_info(documents)').all<{ name: string }>(),
      db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents_fts' LIMIT 1"
      ).all<{ name: string }>()
    ])
    const author = info.results.some(column => column.name === 'author')
    const source = info.results.some(column => column.name === 'source_key')
    const titleSort = info.results.some(column => column.name === 'title_sort')
    const fts = tables.results.length > 0
    if (author && fts && source && titleSort) fullyMigrated.add(db)
    return { author, fts, source, titleSort }
  } catch (error) {
    console.error(JSON.stringify({
      message: 'search_capabilities_unavailable',
      error: error instanceof Error ? error.message : String(error)
    }))
    return { author: false, fts: false, source: false, titleSort: false }
  }
}
