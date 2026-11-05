export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536
export const EMBEDDING_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
export const EMBEDDING_BATCH = 16

interface EmbeddingItem {
  index?: number
  embedding?: unknown
}

export function parseEmbeddings (payload: unknown, expectedCount: number, dimensions: number): number[][] {
  if (!payload || typeof payload !== 'object' || !('data' in payload) || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('OpenRouter embeddings response did not include a data array')
  }

  const data = (payload as { data: EmbeddingItem[] }).data
  const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (ordered.length !== expectedCount) {
    throw new Error(`OpenRouter returned ${ordered.length} embeddings, expected ${expectedCount}`)
  }

  return ordered.map((item, index) => {
    if (!Array.isArray(item.embedding) || item.embedding.some(value => typeof value !== 'number') || item.embedding.length !== dimensions) {
      const length = Array.isArray(item.embedding) ? item.embedding.length : 0
      throw new Error(`Embedding ${index} has length ${length}, expected ${dimensions} floats. Create the Vectorize index with --dimensions=${dimensions}.`)
    }
    return item.embedding as number[]
  })
}

function fixtureEmbedding (text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0)
  const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  for (const token of tokens) {
    let hash = 0
    for (const char of token) hash = (hash * 33 + char.charCodeAt(0)) >>> 0
    const bucket = hash % EMBEDDING_DIMENSIONS
    vector[bucket] = (vector[bucket] ?? 0) + 1
  }
  return vector
}

export async function embedTexts (texts: string[], apiKey: string): Promise<number[][]> {
  // Dev-only stand-in so the upload and search UI can be clicked through without a key.
  // Production builds strip this branch (import.meta.dev is false).
  if (import.meta.dev && process.env.EMBEDDINGS_FIXTURE === '1') {
    return texts.map(fixtureEmbedding)
  }

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set')
  }

  const vectors: number[][] = []
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH)
    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/bine-cadez/hackathon-kaldi-korwell',
        'X-Title': 'Internal document library'
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: 'float'
      })
    })

    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`OpenRouter embeddings failed (${response.status}): ${raw.slice(0, 500)}`)
    }

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      throw new Error('OpenRouter embeddings returned non-JSON')
    }
    vectors.push(...parseEmbeddings(payload, batch.length, EMBEDDING_DIMENSIONS))
  }

  return vectors
}
