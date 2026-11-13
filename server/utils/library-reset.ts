import { createError } from 'h3'
import { readSearchCapabilities } from './capabilities'
import { ensureSchema } from './schema'
import { useLocalVectors } from './vectors'
import type { DocLibraryEnv } from './env'

// The phrase the caller must send, so a stray POST cannot wipe the library.
export const RESET_CONFIRMATION = 'RESET'

// Vectorize accepts at most 1000 ids per deleteByIds call; R2 at most 1000 keys per delete.
const VECTOR_BATCH = 500
const R2_PREFIX = 'documents/'

// Deletes every uploaded document: D1 rows (documents, chunks, FTS), their
// Vectorize vectors, and their files in R2. Leaves the Slack archive, MCP
// OAuth state, migrations, and all config (secrets, bindings) untouched.
export async function resetLibrary (env: DocLibraryEnv) {
  await ensureSchema(env.DB)
  const caps = await readSearchCapabilities(env.DB)

  // Vectors first: their ids only live in D1, so once the rows are gone the
  // vectors could no longer be found. A failure here stops before D1 is touched.
  const { results } = await env.DB.prepare('SELECT id FROM chunks').all<{ id: string }>()
  const chunkIds = results.map(row => row.id)
  if (chunkIds.length > 0 && !useLocalVectors()) {
    try {
      for (let offset = 0; offset < chunkIds.length; offset += VECTOR_BATCH) {
        await env.VECTORIZE.deleteByIds(chunkIds.slice(offset, offset + VECTOR_BATCH))
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(JSON.stringify({ message: 'library_reset_vectorize_failed', error: message }))
      if (!import.meta.dev) {
        throw createError({
          statusCode: 502,
          statusMessage: 'Could not clear Vectorize',
          data: { message: 'Could not delete the search vectors. Nothing else was deleted; try again.' }
        })
      }
    }
  }

  const { count } = await env.DB.prepare('SELECT COUNT(*) AS count FROM documents').first<{ count: number }>() ?? { count: 0 }
  // One batch is one transaction: both tables empty, or neither.
  const statements = [
    env.DB.prepare('DELETE FROM chunks'),
    env.DB.prepare('DELETE FROM documents')
  ]
  // The delete trigger already empties the index; this also drops any stray rows.
  if (caps.fts) statements.push(env.DB.prepare('DELETE FROM documents_fts'))
  await env.DB.batch(statements)

  let filesDeleted = 0
  let storage: 'cleared' | 'skipped' | 'failed' = env.BLOB ? 'cleared' : 'skipped'
  if (env.BLOB) {
    try {
      // Each pass deletes the first page, so the next list starts from the top again.
      while (true) {
        const page = await env.BLOB.list({ prefix: R2_PREFIX })
        const keys = page.objects.map(object => object.key)
        if (keys.length === 0) break
        await env.BLOB.delete(keys)
        filesDeleted += keys.length
        if (!page.truncated) break
      }
    } catch (error) {
      // D1 is already empty, so the app shows a clean library either way.
      storage = 'failed'
      console.error(JSON.stringify({
        message: 'library_reset_r2_failed',
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const summary = {
    documentsDeleted: Number(count),
    chunksDeleted: chunkIds.length,
    filesDeleted,
    storage
  }
  console.log(JSON.stringify({ message: 'library_reset', ...summary }))
  return summary
}
