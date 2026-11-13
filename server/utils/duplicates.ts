import { createError } from 'h3'
import type { DocDatabase } from './env.ts'

// Duplicate uploads are detected by a SHA-256 of the normalized body (the text
// that gets chunked), so the same file re-uploaded, renamed, or pasted matches.
// The check runs before embeddings, so a duplicate costs no OpenRouter call.

const OFF_VALUES = new Set(['off', 'false', '0', 'no', 'disabled'])

// On unless DUPLICATE_CHECK is off/false/0/no. Set it in .env for `npm run dev`,
// or as a Worker variable/secret. The hash is still stored while the check is
// off, so turning it back on covers documents uploaded in the meantime.
export function duplicateCheckEnabled (...sources: Array<string | undefined>): boolean {
  const value = sources.find(source => typeof source === 'string' && source.trim() !== '')
  return value === undefined || !OFF_VALUES.has(value.trim().toLowerCase())
}

export async function contentHash (body: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

type HashDb = Pick<DocDatabase, 'prepare' | 'batch'>

// PR previews share production D1 and do not run migrations, so the column may
// be missing. Without it the check is skipped and saves work as before.
const migrated = new WeakSet<HashDb>()

export async function hasContentHashColumn (db: HashDb): Promise<boolean> {
  if (migrated.has(db)) return true
  try {
    const info = await db.prepare('PRAGMA table_info(documents)').all<{ name: string }>()
    const present = info.results.some(column => column.name === 'content_hash')
    if (present) migrated.add(db)
    return present
  } catch {
    return false
  }
}

// Hash documents saved before migration 0006. Bounded per call and written as
// one batch, so a request stays inside D1's per-request query budget.
export const BACKFILL_BATCH = 50

export async function backfillContentHashes (db: HashDb, limit = BACKFILL_BATCH): Promise<number> {
  const { results } = await db.prepare(
    'SELECT id, body FROM documents WHERE content_hash IS NULL LIMIT ?'
  ).bind(limit).all<{ id: string, body: string }>()
  if (results.length === 0) return 0
  const updates = await Promise.all(results.map(async row => db.prepare(
    'UPDATE documents SET content_hash = ? WHERE id = ?'
  ).bind(await contentHash(row.body.replace(/\r\n/g, '\n').trim()), row.id)))
  await db.batch(updates)
  return results.length
}

export interface DuplicateDocument {
  id: string
  title: string
  createdAt: string
}

export async function findDuplicate (db: HashDb, hash: string): Promise<DuplicateDocument | null> {
  // Each upload hashes up to BACKFILL_BATCH older rows first. A library with
  // more unhashed rows than that is fully covered after a few uploads.
  await backfillContentHashes(db)
  const row = await db.prepare(
    'SELECT id, title, created_at FROM documents WHERE content_hash = ? ORDER BY created_at LIMIT 1'
  ).bind(hash).first<{ id: string, title: string, created_at: string }>()
  return row ? { id: row.id, title: row.title, createdAt: row.created_at } : null
}

export function duplicateError (duplicate: DuplicateDocument) {
  const message = `This document is already in the archive as “${duplicate.title}”.`
  return createError({
    statusCode: 409,
    statusMessage: 'Duplicate document',
    message,
    data: { message, duplicate }
  })
}
