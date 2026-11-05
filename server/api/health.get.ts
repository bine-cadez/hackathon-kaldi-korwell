import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../utils/embeddings'
import { readCloudflareEnv } from '../utils/env'
import { useLocalVectors } from '../utils/vectors'

export default defineEventHandler((event) => {
  const env = readCloudflareEnv(event)
  return {
    ok: Boolean(env?.DB && env?.VECTORIZE),
    internalOnly: true,
    auth: 'none',
    embeddingModel: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    vectorBackend: useLocalVectors() ? 'd1' : 'vectorize',
    bindings: {
      db: Boolean(env?.DB),
      vectorize: Boolean(env?.VECTORIZE),
      blob: Boolean(env?.BLOB)
    }
  }
})
