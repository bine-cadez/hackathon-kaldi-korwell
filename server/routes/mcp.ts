import { getOpenRouterApiKey, readCloudflareEnv } from '../utils/env.ts'
import { mcpSigningKeyFromEvent } from '../utils/mcp-auth.ts'
import { createMcpHandler } from '../utils/mcp-http.ts'
import { defaultLibrary } from '../utils/mcp-library.ts'

export default createMcpHandler({
  library: defaultLibrary,
  signingKey: mcpSigningKeyFromEvent,
  apiKey: event => getOpenRouterApiKey(event),
  env: event => readCloudflareEnv(event)
})
