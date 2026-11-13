import { listDocuments, parseDocumentListQuery } from '../../utils/document-list'
import { requireEnv, toHttpError } from '../../utils/env'

// GET /api/documents?q=&author=&from=&to=&sort=newest|oldest|title&page=1&pageSize=20
export default defineEventHandler(async (event) => {
  try {
    const query = parseDocumentListQuery(getQuery(event))
    return await listDocuments(requireEnv(event), query)
  } catch (error) {
    throw toHttpError(error)
  }
})
