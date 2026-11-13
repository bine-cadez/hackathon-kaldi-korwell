import { contentDisposition } from '../../../utils/document-storage'
import { assertDocumentId, getDocumentSource } from '../../../utils/documents'
import { requireEnv, toHttpError } from '../../../utils/env'

// Downloads the file exactly as it was uploaded (before markdown conversion).
export default defineEventHandler(async (event) => {
  try {
    const id = assertDocumentId(getRouterParam(event, 'id'))
    const source = await getDocumentSource(requireEnv(event), id)
    setResponseHeaders(event, {
      'content-type': source.contentType,
      'content-length': source.size,
      'content-disposition': contentDisposition(source.filename),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store'
    })
    return source.body
  } catch (error) {
    throw toHttpError(error)
  }
})
