import type { AccessUser } from '../../utils/cloudflare-access'
import { extractFileText, titleFromFilename } from '../../utils/document-file'
import { saveDocument, type UploadedFileInfo } from '../../utils/documents'
import { readCloudflareEnv, requireEnv, requireOpenRouterApiKey, toHttpError } from '../../utils/env'

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
    let fileName = ''
    let file: (typeof parts)[number] | undefined
    for (const part of parts) {
      const text = part.data.toString('utf8')
      if (part.name === 'title') title = text
      if (part.name === 'author') author = text
      // Sent as its own field: h3 splits Content-Disposition on ";" and "=",
      // so a name like "Q1; final=v2.pdf" would not survive part.filename.
      if (part.name === 'fileName') fileName = text
      if (part.name === 'body' && !body) body = text
      if (part.name === 'file' && part.data.length > 0) file = part
    }
    let fileInfo: UploadedFileInfo | null = null
    if (file) {
      const name = fileName.trim() || file.filename || ''
      // PDF, Word, and Excel files are converted to markdown by Workers AI.
      body = await extractFileText({ ...file, filename: name || file.filename }, readCloudflareEnv(event)?.AI)
      if (!title.trim() && name) title = titleFromFilename(name)
      fileInfo = { name, size: file.data.length, type: file.type }
    }
    return { title, body, author, file: fileInfo }
  }

  const payload = await readBody(event)
  if (!payload || typeof payload !== 'object') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Expected JSON { title, body }',
      data: { message: 'Expected JSON { title, body }' }
    })
  }
  const record = payload as { title?: unknown, body?: unknown, author?: unknown, file?: unknown }
  // Text files are read in the browser and sent as JSON; `file` describes the original.
  const file = record.file && typeof record.file === 'object' ? record.file as UploadedFileInfo : null
  return {
    title: typeof record.title === 'string' ? record.title : '',
    body: typeof record.body === 'string' ? record.body : '',
    author: typeof record.author === 'string' ? record.author : '',
    file
  }
}

export default defineEventHandler(async (event) => {
  try {
    const input = await readDocumentInput(event)
    // Set by the site-password middleware only after it verifies a Cloudflare
    // Access assertion. In shared-password mode nobody is identified.
    const uploader = (event.context.korwellAccessUser as AccessUser | undefined) ?? null
    return await saveDocument(requireEnv(event), requireOpenRouterApiKey(event), { ...input, uploader })
  } catch (error) {
    throw toHttpError(error)
  }
})
