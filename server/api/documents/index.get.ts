import { listDocuments } from '../../utils/documents'
import { requireEnv, toHttpError } from '../../utils/env'

export default defineEventHandler(async (event) => {
  try {
    const documents = await listDocuments(requireEnv(event))
    return { documents }
  } catch (error) {
    throw toHttpError(error)
  }
})
