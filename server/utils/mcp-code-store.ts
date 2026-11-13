import type { UsedCodeStore } from './mcp-auth.ts'

interface CodeStoreStatement {
  bind (...values: unknown[]): CodeStoreStatement
  first<T>(): Promise<T | null>
  run (): Promise<unknown>
}

export interface CodeStoreDatabase {
  prepare (query: string): CodeStoreStatement
}

// Matches migrations/0004_mcp_used_codes.sql. PR previews share the production
// D1 but do not run migrations, so the table is also created on first use.
const CREATE_TABLE = 'CREATE TABLE IF NOT EXISTS mcp_used_codes (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
const CREATE_INDEX = 'CREATE INDEX IF NOT EXISTS idx_mcp_used_codes_expires_at ON mcp_used_codes (expires_at)'

// Keep a row a little past the code's exp, beyond the JWT clock tolerance.
const KEEP_AFTER_EXPIRY_SECONDS = 300

const ready = new WeakSet<object>()

async function ensureTable (db: CodeStoreDatabase) {
  if (ready.has(db)) return
  await db.prepare(CREATE_TABLE).run()
  await db.prepare(CREATE_INDEX).run()
  ready.add(db)
}

export function d1UsedCodeStore (db: CodeStoreDatabase | undefined | null): UsedCodeStore | null {
  if (!db || typeof db.prepare !== 'function') return null
  return {
    async consume (jti: string, expiresAt: number): Promise<boolean> {
      await ensureTable(db)
      const now = Math.floor(Date.now() / 1000)
      await db.prepare('DELETE FROM mcp_used_codes WHERE expires_at < ?1').bind(now).run()
      // One statement, so two concurrent redemptions cannot both win.
      const row = await db.prepare(
        'INSERT INTO mcp_used_codes (jti, expires_at) VALUES (?1, ?2) ON CONFLICT (jti) DO NOTHING RETURNING jti'
      ).bind(jti, expiresAt + KEEP_AFTER_EXPIRY_SECONDS).first<{ jti: string }>()
      return Boolean(row?.jti)
    }
  }
}
