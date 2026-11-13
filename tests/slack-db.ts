import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SlackWebClient } from '../server/utils/slack-api.ts'
import type { DocDatabase } from '../server/utils/env.ts'

export function openSlackDb (applyArchive = true) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'))
  if (applyArchive) sqlite.exec(readFileSync(new URL('../migrations/0003_slack_archive.sql', import.meta.url), 'utf8'))
  return { sqlite, db: wrapSqlite(sqlite) }
}

export function wrapSqlite (sqlite: DatabaseSync): DocDatabase {
  return {
    exec (sql) {
      sqlite.exec(sql)
      return Promise.resolve()
    },
    prepare (query) {
      const statement = sqlite.prepare(query)
      let bound: unknown[] = []
      const api = {
        bind (...values: unknown[]) {
          bound = values
          return api
        },
        all<T> () {
          const results = (bound.length ? statement.all(...(bound as [])) : statement.all()) as T[]
          return Promise.resolve({ results })
        },
        first<T> () {
          const row = bound.length ? statement.get(...(bound as [])) : statement.get()
          return Promise.resolve((row ?? null) as T | null)
        },
        run () {
          const result = bound.length ? statement.run(...(bound as [])) : statement.run()
          return Promise.resolve({ meta: { changes: Number(result.changes ?? 0) } })
        }
      }
      return api
    },
    batch (statements) {
      return Promise.all(statements.map(statement => statement.run()))
    }
  }
}

export function fakeSlackClient (overrides: Partial<SlackWebClient> = {}): SlackWebClient {
  const client: SlackWebClient = {
    authTest: async () => ({ teamId: 'T1' }),
    usersInfo: async (userId) => {
      if (userId === 'UMAJA') return { displayName: 'maja', realName: 'Maja Župan' }
      if (userId === 'UANA') return { displayName: 'ana', realName: 'Ana Kovač' }
      return { displayName: userId, realName: userId }
    },
    conversationsInfo: async (channelId) => ({ name: channelId === 'C_ALLOW' ? 'splošno' : 'drugo' }),
    getPermalink: async (channelId, messageTs) => `https://kaldi.slack.com/archives/${channelId}/p${messageTs.replace('.', '')}`,
    conversationsHistory: async () => { throw new Error('history not stubbed') },
    conversationsReplies: async () => { throw new Error('replies not stubbed') }
  }
  return { ...client, ...overrides }
}
