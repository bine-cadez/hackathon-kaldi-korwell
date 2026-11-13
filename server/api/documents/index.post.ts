import type { AccessUser } from '../../utils/cloudflare-access'
import { extractFileText, titleFromFilename } from '../../utils/document-file'
import { toSourceFile, type SourceFile } from '../../utils/document-storage'
import { saveDocument } from '../../utils/documents'
import { readCloudflareEnv, requireEnv, requireOpenRouterApiKey, toHttpError } from '../../utils/env'

async function readDocumentInput (event: Parameters<typeof readBody>[0]): Promise<{ title: string, body: string, author: string, source?: SourceFile }> {
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
    let file: (typeof parts)[number] | undefined
    for (const part of parts) {
      const text = part.data.toString('utf8')
      if (part.name === 'title') title = text
      if (part.name === 'author') author = text
      if (part.name === 'body' && !body) body = text
      if (part.name === 'file' && part.data.length > 0) file = part
    }
    if (file) {
      // PDF, Word, and Excel files are converted to markdown by Workers AI.
      body = await extractFileText(file, readCloudflareEnv(event)?.AI)
      if (!title.trim() && file.filename) title = titleFromFilename(file.filename)
      // Kept in R2 next to the markdown so the original can be downloaded later.
      return { title, body, author, source: toSourceFile(file) }
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
    // Set by the Cloudflare Access middleware after it verifies the JWT. Shared-password mode has no identity.
    const uploadedBy = (event.context.korwellAccessUser as AccessUser | undefined)?.email ?? null
    const saved = await saveDocument(requireEnv(event), requireOpenRouterApiKey(event), { ...input, uploadedBy })
    // Count the saved text, including text extracted from uploaded files.
    const wordCount = input.body.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu)?.length ?? 0
    return { ...saved, wordCount }
  } catch (error) {
    throw toHttpError(error)
  }
})
