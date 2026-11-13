import assert from 'node:assert/strict'
import test from 'node:test'
import { chunkText } from '../server/utils/chunk.ts'
import { csvToText, detectDelimiter, parseCsv } from '../server/utils/csv.ts'
import { extractFileText, titleFromFilename } from '../server/utils/document-file.ts'

const bytes = (text: string) => new TextEncoder().encode(text)

test('parseCsv handles quotes, escaped quotes, embedded newlines, and CRLF', () => {
  const rows = parseCsv('name,note\r\n"Novak, Ana","She said ""hi""\nthen left"\r\nŽupan,ok\r\n')
  assert.deepEqual(rows, [
    ['name', 'note'],
    ['Novak, Ana', 'She said "hi"\nthen left'],
    ['Župan', 'ok']
  ])
})

test('detectDelimiter picks semicolons and tabs from the header line', () => {
  assert.equal(detectDelimiter('Ime;Priimek;Mesto\nAna;Novak;Kranj'), ';')
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t')
  assert.equal(detectDelimiter('"x;y",b,c\n1,2,3'), ',')
})

test('csvToText writes one labelled row per paragraph and skips empty cells', () => {
  const text = csvToText('﻿Ime;Mesto;Opomba\nAna;Kranj;\n;;\nMarko;;VIP\n')
  assert.equal(text, 'Ime: Ana; Mesto: Kranj\n\nIme: Marko; Opomba: VIP')
})

test('csvToText labels blank or extra columns', () => {
  assert.equal(csvToText('a,\n1,2,3'), 'a: 1; Column 2: 2; Column 3: 3')
})

test('chunks of a long CSV keep whole rows with their column names', () => {
  const lines = ['id,product,description']
  for (let i = 0; i < 200; i++) lines.push(`${i},Coffee ${i},"Roasted, ${'x'.repeat(40)}"`)
  const rows = csvToText(lines.join('\n')).split('\n\n')
  const chunks = chunkText(rows.join('\n\n'))
  assert.ok(chunks.length > 1)
  // Every row lands whole in some chunk. A chunk may open with a partial row,
  // which is the chunker's 150-character overlap from the previous chunk.
  const whole = new Set(chunks.flatMap(chunk => chunk.split('\n\n')))
  for (const row of rows) assert.ok(whole.has(row), `row split across chunks: ${row}`)
})

test('csv uploads are converted without Workers AI', async () => {
  const text = await extractFileText({ filename: 'Stranke.CSV', data: bytes('name,city\nAna,Kranj') }, undefined)
  assert.equal(text, 'name: Ana; city: Kranj')
  assert.equal(titleFromFilename('Stranke.CSV'), 'Stranke')
})

test('a Windows-1250 csv from Slovenian Excel keeps č, š and ž', async () => {
  // "ime;kraj\nŽiga Čuk;Škofja Loka" in Windows-1250: Ž=0x8E, Č=0xC8, Š=0x8A.
  const data = Uint8Array.from([
    ...bytes('ime;kraj\n'), 0x8e, ...bytes('iga '), 0xc8, ...bytes('uk;'), 0x8a, ...bytes('kofja Loka')
  ])
  const text = await extractFileText({ filename: 'Stranke.csv', data }, undefined)
  assert.equal(text, 'ime: Žiga Čuk; kraj: Škofja Loka')
})

test('a header-only csv is rejected with 422', async () => {
  await assert.rejects(
    extractFileText({ filename: 'empty.csv', data: bytes('name,city\n') }, undefined),
    (error: { statusCode?: number }) => error.statusCode === 422
  )
})
