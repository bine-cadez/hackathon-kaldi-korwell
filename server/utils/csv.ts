// CSV uploads are turned into one paragraph per row ("Header: value; Header: value").
// The chunker splits on blank lines, so every chunk keeps whole rows and each row
// carries its own column names. That keeps embeddings and keyword hits meaningful
// even for chunks far from the header line.

const DELIMITERS = [',', ';', '\t'] as const

// Excel in Slovenian (and most EU) locales exports with ';'. Pick the delimiter
// that appears most often in the header line, outside quotes.
export function detectDelimiter (text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  let best: string = ','
  let bestCount = 0
  for (const delimiter of DELIMITERS) {
    let count = 0
    let quoted = false
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted
      else if (!quoted && char === delimiter) count++
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

// RFC 4180: quoted fields may contain the delimiter, newlines, and "" for a quote.
export function parseCsv (input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''))
}

function clean (value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function csvToText (input: string): string {
  const [header, ...rows] = parseCsv(input)
  if (!header) return ''
  const names = header.map((name, index) => clean(name) || `Column ${index + 1}`)
  return rows
    .map(cells => cells
      .map((cell, index) => [names[index] || `Column ${index + 1}`, clean(cell)] as const)
      .filter(([, value]) => value !== '')
      .map(([name, value]) => `${name}: ${value}`)
      .join('; '))
    .filter(Boolean)
    .join('\n\n')
}
