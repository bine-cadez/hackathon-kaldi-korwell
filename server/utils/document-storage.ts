import { CONVERTIBLE_TYPES, fileExtension } from './document-file.ts'
import type { R2Bucket } from './env.ts'
import { normalizeUnicode } from '../../shared/utils/text.ts'

// R2 layout: everything for one document sits under documents/<id>/.
//   documents/<id>/content.md        the markdown that was chunked and embedded
//   documents/<id>/original.<ext>    the file as it was uploaded
const FILENAME_MAX = 255

const TEXT_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8'
}

export interface SourceFile {
  filename: string
  contentType: string
  data: Uint8Array
}

export function documentPrefix (documentId: string): string {
  return `documents/${documentId}/`
}

export function markdownKey (documentId: string): string {
  return `${documentPrefix(documentId)}content.md`
}

export function sourceKey (documentId: string, filename: string): string {
  const extension = fileExtension(filename)
  return `${documentPrefix(documentId)}original${extension ? `.${extension}` : ''}`
}

// The stored type comes from the extension we accepted, never from the browser,
// so a download cannot be served as text/html.
export function sourceContentType (filename: string): string {
  const extension = fileExtension(filename)
  return CONVERTIBLE_TYPES[extension] ?? TEXT_TYPES[extension] ?? 'application/octet-stream'
}

export function normalizeSourceFilename (filename: string | undefined): string {
  // Browsers send a basename, but strip any path and control characters anyway.
  const base = (filename || '').split(/[\\/]/).pop() || ''
  // Composed Unicode (NFC): macOS can hand over "č" as c + combining caron.
  const clean = normalizeUnicode(base.replace(/[\u0000-\u001f\u007f]/g, '')).trim()
  return (clean || 'upload').slice(0, FILENAME_MAX)
}

export function toSourceFile (file: { filename?: string, data: Uint8Array }): SourceFile {
  const filename = normalizeSourceFilename(file.filename)
  return { filename, contentType: sourceContentType(filename), data: file.data }
}

// RFC 6266: an ASCII fallback plus the UTF-8 name, so "Poročilo.pdf" downloads intact.
export function contentDisposition (filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

// Removes every object under documents/<id>/, plus any older key that lived elsewhere.
export async function deleteDocumentObjects (bucket: R2Bucket, documentId: string, extraKeys: Array<string | null | undefined> = []) {
  const keys = new Set(extraKeys.filter((key): key is string => Boolean(key)))
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: documentPrefix(documentId), cursor })
    for (const object of page.objects) keys.add(object.key)
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  if (keys.size > 0) await bucket.delete([...keys])
}
