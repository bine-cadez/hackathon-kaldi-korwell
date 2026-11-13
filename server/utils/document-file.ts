import { createError } from 'h3'
import { csvToText } from './csv.ts'
import { decodeTextBytes } from '../../shared/utils/text.ts'
import type { ConversionResult, WorkersAI } from './env.ts'

// Plain-text uploads are decoded as UTF-8, or Windows-1250 / ISO-8859-2 when the
// bytes are not valid UTF-8 (shared/utils/text.ts). Everything in CONVERTIBLE_TYPES goes
// through Workers AI toMarkdown first, so the rest of the pipeline only sees text.
// CSV is decoded as text and then rewritten one row per paragraph (see csv.ts).
export const TEXT_EXTENSIONS = ['md', 'markdown', 'txt', 'csv'] as const

export const CONVERTIBLE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
  xls: 'application/vnd.ms-excel'
}

export const FILE_MAX_BYTES = 10 * 1024 * 1024

export interface UploadedFile {
  filename?: string
  type?: string
  data: Uint8Array
}

function fail (statusCode: number, statusMessage: string, message = statusMessage): never {
  throw createError({ statusCode, statusMessage, message, data: { message } })
}

export function fileExtension (filename: string | undefined): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename || '')
  return match ? match[1]!.toLowerCase() : ''
}

export function isConvertible (filename: string | undefined): boolean {
  return fileExtension(filename) in CONVERTIBLE_TYPES
}

export function titleFromFilename (filename: string): string {
  const extension = fileExtension(filename)
  const known = (TEXT_EXTENSIONS as readonly string[]).includes(extension) || extension in CONVERTIBLE_TYPES
  return known ? filename.slice(0, -(extension.length + 1)) : filename
}

export async function extractFileText (file: UploadedFile, ai: WorkersAI | undefined): Promise<string> {
  if (file.data.byteLength > FILE_MAX_BYTES) {
    fail(413, `File must be ${FILE_MAX_BYTES / 1024 / 1024} MB or smaller`)
  }
  if (fileExtension(file.filename) === 'csv') return csvFileText(file)
  if (!isConvertible(file.filename)) return decodeText(file)
  return convertToMarkdown(file, ai)
}

function decodeText (file: UploadedFile): string {
  const { text } = decodeTextBytes(file.data)
  // A NUL byte means a binary format we do not convert (.doc, .pptx, images…).
  if (text.includes('\u0000')) {
    const supported = [...TEXT_EXTENSIONS, ...Object.keys(CONVERTIBLE_TYPES)].map(ext => `.${ext}`).join(', ')
    fail(415, 'Unsupported file type', `${file.filename || 'This file'} is not a supported type. Upload ${supported}.`)
  }
  return text
}

function csvFileText (file: UploadedFile): string {
  const text = csvToText(decodeText(file))
  if (!text) fail(422, 'No rows found in CSV', `${file.filename} has a header but no data rows.`)
  return text
}

async function convertToMarkdown (file: UploadedFile, ai: WorkersAI | undefined): Promise<string> {
  const name = file.filename!
  if (!ai) {
    fail(503, 'Workers AI binding is unavailable',
      'The AI binding is missing, so PDF, Word, and Excel files cannot be converted. npm run dev does not load it. Use the deployed Worker, or npx wrangler login then npm run build && npm run preview. Text and markdown uploads still work.')
  }

  const type = CONVERTIBLE_TYPES[fileExtension(name)]!
  let result: ConversionResult | ConversionResult[]
  try {
    result = await ai.toMarkdown(
      { name, blob: new Blob([file.data as Uint8Array<ArrayBuffer>], { type }) },
      { conversionOptions: { pdf: { metadata: false } } }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(JSON.stringify({ message: 'to_markdown_failed', filename: name, error: message }))
    fail(502, 'File conversion failed', `Workers AI could not convert ${name}: ${message}`)
  }

  const converted = Array.isArray(result) ? result[0] : result
  if (!converted || converted.format === 'error') {
    fail(422, 'File conversion failed', `Workers AI could not convert ${name}${converted?.error ? `: ${converted.error}` : '.'}`)
  }
  const text = (converted.data || '').trim()
  if (!text) {
    fail(422, 'No text found in file', `No text found in ${name}. Scanned PDFs without a text layer are not supported.`)
  }
  return text
}
