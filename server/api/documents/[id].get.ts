import { assertDocumentId, getDocument } from '../../utils/documents'
import { requireEnv, toHttpError } from '../../utils/env'

export default defineEventHandler(async (event) => {
  try {
    const id = assertDocumentId(getRouterParam(event, 'id'))
    return await getDocument(requireEnv(event), id)
  } catch (error) {
    throw toHttpError(error)
  }
})
