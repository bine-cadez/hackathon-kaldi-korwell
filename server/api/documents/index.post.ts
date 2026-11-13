import { saveDocument } from '../../utils/documents'
import { requireEnv, requireOpenRouterApiKey, toHttpError } from '../../utils/env'

async function readDocumentInput (event: Parameters<typeof readBody>[0]) {
  const contentType = getHeader(event, 'content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const parts = await readMultipartFormData(event)
    if (!parts) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Expected multipart form data',
        data: { message: 'Expected multipart form data with title and file or body' }
      })
    }
    let title = ''
    let body = ''
    let author = ''
    for (const part of parts) {
      const text = part.data.toString('utf8')
      if (part.name === 'title') title = text
      if (part.name === 'author') author = text
      if (part.name === 'body' && !body) body = text
      if (part.name === 'file' && part.data.length > 0) {
        body = text
        if (!title && part.filename) title = part.filename.replace(/\.(md|markdown|txt)$/i, '')
      }
    }
    return { title, body, author }
  }

  const payload = await readBody(event)
  if (!payload || typeof payload !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Expected JSON { title, body }',
      data: { message: 'Expected JSON { title, body }' }
    })
  }
  const record = payload as { title?: unknown, body?: unknown, author?: unknown }
  return {
    title: typeof record.title === 'string' ? record.title : '',
    body: typeof record.body === 'string' ? record.body : '',
    author: typeof record.author === 'string' ? record.author : ''
  }
}

export default defineEventHandler(async (event) => {
  try {
    const input = await readDocumentInput(event)
    return await saveDocument(requireEnv(event), requireOpenRouterApiKey(event), input)
  } catch (error) {
    throw toHttpError(error)
  }
})
