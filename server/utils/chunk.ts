export const TARGET_CHARS = 1200
export const OVERLAP_CHARS = 150
export const MAX_CHUNKS = 48

export class ChunkLimitError extends Error {
  constructor () {
    super(`This document exceeds the v1 limit of ${MAX_CHUNKS} chunks. Split it into smaller uploads.`)
    this.name = 'ChunkLimitError'
  }
}

function pushChunk (chunks: string[], chunk: string) {
  const trimmed = chunk.trim()
  if (!trimmed) return
  chunks.push(trimmed)
  if (chunks.length > MAX_CHUNKS) throw new ChunkLimitError()
}

function splitLong (text: string): string[] {
  const parts: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + TARGET_CHARS, text.length)
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end)
      if (space > start + Math.floor(TARGET_CHARS / 2)) end = space
    }
    const piece = text.slice(start, end).trim()
    if (piece) parts.push(piece)
    if (end >= text.length) break
    const next = end - OVERLAP_CHARS
    start = next > start ? next : start + 1
  }
  return parts
}

export function chunkText (input: string): string[] {
  const text = input.replace(/\r\n/g, '\n').trim()
  if (!text) return []

  const paragraphs = text.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if (paragraph.length > TARGET_CHARS) {
      if (current) {
        pushChunk(chunks, current)
        current = ''
      }
      for (const piece of splitLong(paragraph)) pushChunk(chunks, piece)
      continue
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph
    if (current && next.length > TARGET_CHARS) {
      pushChunk(chunks, current)
      const overlap = current.slice(-OVERLAP_CHARS).trim()
      const withOverlap = overlap ? `${overlap}\n\n${paragraph}` : paragraph
      current = withOverlap.length <= TARGET_CHARS ? withOverlap : paragraph
    } else {
      current = next
    }
  }

  if (current) pushChunk(chunks, current)
  return chunks
}
