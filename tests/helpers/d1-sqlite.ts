import { DatabaseSync } from 'node:sqlite'

// A tiny D1-shaped wrapper over Node's built-in SQLite, so tests run the real SQL.
export function sqliteD1 () {
  const db = new DatabaseSync(':memory:')
  function statement (sql: string, params: unknown[] = []) {
    return {
      bind: (...values: unknown[]) => statement(sql, values),
      first: async <T>() => (db.prepare(sql).get(...(params as never[])) as T | undefined) ?? null,
      run: async () => db.prepare(sql).run(...(params as never[])),
      all: async <T>() => ({ results: db.prepare(sql).all(...(params as never[])) as T[] })
    }
  }
  return { prepare: (sql: string) => statement(sql), raw: db }
}
