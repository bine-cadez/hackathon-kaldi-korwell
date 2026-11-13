import { contentDisposition, isInlineSource, sourceContentType } from '../../../utils/document-storage'
import { assertDocumentId, getDocumentSource } from '../../../utils/documents'
import { requireEnv, toHttpError } from '../../../utils/env'

// Serves the file exactly as it was uploaded (before markdown conversion).
// A download by default. With ?inline=1 a PDF opens in the browser's viewer
// (the reader's preview pane). Every other type stays a download.
export default defineEventHandler(async (event) => {
  try {
    const id = assertDocumentId(getRouterParam(event, 'id'))
    const source = await getDocumentSource(requireEnv(event), id)
    const inline = getQuery(event).inline === '1' && isInlineSource(source.filename)
    setResponseHeaders(event, {
      // Inline responses take their type from the extension again, not the stored column.
      'content-type': inline ? sourceContentType(source.filename) : source.contentType,
      'content-length': source.size,
      'content-disposition': contentDisposition(source.filename, { inline }),
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, no-store'
    })
    return source.body
  } catch (error) {
    throw toHttpError(error)
  }
})
