import { requireEnv, requireOpenRouterApiKey, toHttpError } from '../utils/env'
import { searchDocuments } from '../utils/search'

function optionalText (value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export default defineEventHandler(async (event) => {
  try {
    const payload = await readBody(event)
    const record = payload && typeof payload === 'object' ? payload as {
      query?: unknown
      topK?: unknown
      from?: unknown
      to?: unknown
      title?: unknown
      author?: unknown
    } : {}
    const query = optionalText(record.query)
    const from = optionalText(record.from)
    const to = optionalText(record.to)
    const title = optionalText(record.title)
    const author = optionalText(record.author)
    const requested = typeof record.topK === 'number' ? record.topK : Number(record.topK)
    const topK = Number.isFinite(requested) ? Math.min(20, Math.max(1, Math.trunc(requested))) : 5
    const result = await searchDocuments(requireEnv(event), requireOpenRouterApiKey(event), query, topK, {
      from,
      to,
      title,
      author
    })
    return {
      query,
      topK,
      from: from || null,
      to: to || null,
      title: title || null,
      author: author || null,
      backend: result.backend,
      matches: result.matches
    }
  } catch (error) {
    throw toHttpError(error)
  }
})
