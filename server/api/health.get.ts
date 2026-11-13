import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from '../utils/embeddings'
import { accessConfig } from '../utils/cloudflare-access.ts'
import { readCloudflareEnv } from '../utils/env'
import { sitePasswordFromSources } from '../utils/site-password.ts'
import { useLocalVectors } from '../utils/vectors'

export default defineEventHandler((event) => {
  const env = readCloudflareEnv(event)
  const locked = Boolean(sitePasswordFromSources(env?.SITE_PASSWORD, process.env.SITE_PASSWORD))
  const access = accessConfig(event)
  const auth = access.mode === 'disabled' ? (locked ? 'password' : 'open') : 'cloudflare-access'
  return {
    ok: Boolean(env?.DB && env?.VECTORIZE && access.mode !== 'misconfigured'),
    internalOnly: true,
    auth,
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
