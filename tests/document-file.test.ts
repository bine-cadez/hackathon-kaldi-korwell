import assert from 'node:assert/strict'
import test from 'node:test'
import { extractFileText, uploadedFileText } from '../server/utils/document-file.ts'
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
  // Other types still use the server's extraction, ignoring any body.
  assert.equal(await uploadedFileText({ filename: 'a.csv', data: text('name\nAna') }, 'ignored', undefined), 'name: Ana')
})
