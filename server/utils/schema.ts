// Base tables only (migrations/0001_init.sql). Author and the FTS5 index live in
// migrations/0002_document_search.sql and are not applied here: PR previews share
// production D1 and must keep working before that migration runs.
export const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  r2_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents (id)
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks (document_id);
`

interface SchemaDb {
  exec (sql: string): Promise<unknown>
  prepare (sql: string): {
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  }
}

// The base tables never go away once created, so check once per Worker isolate
// instead of paying four sequential D1 round trips on every request.
const schemaReady = new WeakMap<SchemaDb, Promise<void>>()

export function ensureSchema (db: SchemaDb): Promise<void> {
  let ready = schemaReady.get(db)
  if (!ready) {
    ready = applySchema(db).catch((error) => {
      schemaReady.delete(db)
      throw error
    })
    schemaReady.set(db, ready)
  }
  return ready
}

async function applySchema (db: SchemaDb) {
  // Local D1 exec rejects a multi-line script ("incomplete input" on the first line).
  // Run one collapsed statement at a time. Wrangler migrations still use the formatted file.
  const statements = SCHEMA_SQL
    .split(';')
    .map(statement => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  for (const statement of statements) {
    await db.exec(statement)
  }

  const info = await db.prepare('PRAGMA table_info(chunks)').all<{ name: string }>()
  if (!info.results.some(column => column.name === 'embedding')) {
    await db.exec('ALTER TABLE chunks ADD COLUMN embedding TEXT')
  }
}
