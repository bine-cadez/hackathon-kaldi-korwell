import assert from 'node:assert/strict'
import test from 'node:test'
import { extractFileText, FILE_MAX_BYTES, titleFromFilename, uploadedFileText } from '../server/utils/document-file.ts'
import type { ConversionResult, MarkdownDocument, WorkersAI } from '../server/utils/env.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

function fakeAI (result: ConversionResult | ConversionResult[] | Error) {
  const calls: { file: MarkdownDocument, options: unknown }[] = []
  const ai: WorkersAI = {
    async toMarkdown (files, options) {
      calls.push({ file: files as MarkdownDocument, options })
      if (result instanceof Error) throw result
      return result
    }
  }
  return { ai, calls }
}

function statusOf (error: unknown) {
  return (error as { statusCode?: number }).statusCode
}

test('titleFromFilename strips text and convertible extensions only', () => {
  assert.equal(titleFromFilename('Runbook.md'), 'Runbook')
  assert.equal(titleFromFilename('Q3 report.PDF'), 'Q3 report')
  assert.equal(titleFromFilename('budget.v2.xlsx'), 'budget.v2')
  assert.equal(titleFromFilename('notes.log'), 'notes.log')
})

test('text files are decoded without calling Workers AI', async () => {
  const { ai, calls } = fakeAI(new Error('should not be called'))
  const text = await extractFileText({ filename: 'notes.md', data: bytes('# Čokolada\n\nzupan') }, ai)
  assert.equal(text, '# Čokolada\n\nzupan')
  assert.equal(calls.length, 0)
})

test('a file without a filename is still read as text', async () => {
  assert.equal(await extractFileText({ data: bytes('plain') }, undefined), 'plain')
})

test('pdf, docx, and xlsx go through toMarkdown with the right MIME type', async () => {
  const cases: [string, string][] = [
    ['report.pdf', 'application/pdf'],
    ['memo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
  ]
  for (const [filename, type] of cases) {
    const { ai, calls } = fakeAI({ name: filename, format: 'markdown', data: `  converted ${filename}\n` })
    const text = await extractFileText({ filename, data: bytes('%binary%') }, ai)
    assert.equal(text, `converted ${filename}`)
    assert.equal(calls.length, 1)
    assert.equal(calls[0]!.file.name, filename)
    assert.equal(calls[0]!.file.blob.type, type)
    assert.deepEqual(calls[0]!.options, { conversionOptions: { pdf: { metadata: false } } })
  }
})

test('an array result uses the first entry', async () => {
  const { ai } = fakeAI([{ name: 'a.pdf', format: 'markdown', data: 'first' }])
  assert.equal(await extractFileText({ filename: 'a.pdf', data: bytes('x') }, ai), 'first')
})

test('a missing AI binding is a 503 for convertible files', async () => {
  await assert.rejects(
    extractFileText({ filename: 'a.pdf', data: bytes('x') }, undefined),
    error => statusOf(error) === 503
  )
})

test('a conversion error result is a 422 with the provider message', async () => {
  const { ai } = fakeAI({ name: 'a.docx', format: 'error', error: 'corrupt archive' })
  await assert.rejects(
    extractFileText({ filename: 'a.docx', data: bytes('x') }, ai),
    error => statusOf(error) === 422 && /corrupt archive/.test(JSON.stringify((error as { data?: unknown }).data))
  )
})

test('an empty conversion (scanned PDF) is a 422', async () => {
  const { ai } = fakeAI({ name: 'scan.pdf', format: 'markdown', data: '  \n ' })
  await assert.rejects(
    extractFileText({ filename: 'scan.pdf', data: bytes('x') }, ai),
    error => statusOf(error) === 422 && /Scanned PDFs/.test(JSON.stringify((error as { data?: unknown }).data))
  )
})

test('a thrown toMarkdown call is a 502', async () => {
  const { ai } = fakeAI(new Error('upstream down'))
  await assert.rejects(
    extractFileText({ filename: 'a.xlsx', data: bytes('x') }, ai),
    error => statusOf(error) === 502
  )
})

test('binary files we do not convert are a 415', async () => {
  await assert.rejects(
    extractFileText({ filename: 'old.doc', data: new Uint8Array([0xd0, 0xcf, 0x00, 0x11]) }, undefined),
    error => statusOf(error) === 415
  )
})

test('files over the size cap are a 413', async () => {
  const { ai, calls } = fakeAI({ name: 'big.pdf', format: 'markdown', data: 'x' })
  await assert.rejects(
    extractFileText({ filename: 'big.pdf', data: new Uint8Array(FILE_MAX_BYTES + 1) }, ai),
    error => statusOf(error) === 413
  )
  assert.equal(calls.length, 0)
})

test('an edited body is kept only for a real .md or .txt upload', async () => {
  const text = (value: string) => new TextEncoder().encode(value)
  assert.equal(await uploadedFileText({ filename: 'notes.txt', data: text('original') }, 'edited', undefined), 'edited')
  assert.equal(await uploadedFileText({ filename: 'notes.md', data: text('original') }, '  ', undefined), 'original')
  // A body cannot smuggle an unsupported or binary file past validation.
  await assert.rejects(
    uploadedFileText({ filename: 'tool.exe', data: Uint8Array.of(0x4d, 0x5a, 0, 0) }, 'harmless text', undefined),
    (error: { statusCode?: number }) => error.statusCode === 415
  )
  await assert.rejects(
    uploadedFileText({ filename: 'notes.txt', data: Uint8Array.of(0x41, 0, 0x42) }, 'harmless text', undefined),
    (error: { statusCode?: number }) => error.statusCode === 415
  )
  await assert.rejects(
    uploadedFileText({ filename: 'big.txt', data: new Uint8Array(10 * 1024 * 1024 + 1) }, 'x', undefined),
    (error: { statusCode?: number }) => error.statusCode === 413
  )
  // Other types still use the server's extraction, ignoring any body.
  assert.equal(await uploadedFileText({ filename: 'a.csv', data: text('name\nAna') }, 'ignored', undefined), 'name: Ana')
})
