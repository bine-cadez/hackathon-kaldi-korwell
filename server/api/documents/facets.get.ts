import { listDocumentFacets } from '../../utils/document-list'
import { requireEnv, toHttpError } from '../../utils/env'

// GET /api/documents/facets: authors and uploaders for the Library filters.
export default defineEventHandler(async (event) => {
  try {
    return await listDocumentFacets(requireEnv(event))
  } catch (error) {
    throw toHttpError(error)
  }
})
