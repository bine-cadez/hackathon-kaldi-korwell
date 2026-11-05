import { searchDocuments } from '../utils/documents'
import { requireEnv, requireOpenRouterApiKey, toHttpError } from '../utils/env'

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)
    const record = payload && typeof payload === 'object' ? payload as { query?: unknown, topK?: unknown } : {}
    const query = typeof record.query === 'string' ? record.query : ''
    const requested = typeof record.topK === 'number' ? record.topK : Number(record.topK)
    const topK = Number.isFinite(requested) ? Math.min(20, Math.max(1, Math.trunc(requested))) : 5
    const result = await searchDocuments(requireEnv(event), requireOpenRouterApiKey(event), query, topK)
    return { query: query.trim(), topK, backend: result.backend, matches: result.matches }
  } catch (error) {
    throw toHttpError(error)
  }
})
