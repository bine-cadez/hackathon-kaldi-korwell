export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INSTRUCTIONS = 'Korwell document library, read-only. Call search with a natural-language query, then fetch with a result id to read the full text. search also accepts optional limit, from, to, and author. Do not invent ids. There are no tools that create, edit, or delete anything.'

export interface SearchFilters {
  from?: string
  to?: string
  author?: string
}

export interface LibraryMatch {
  documentId: string
  title: string
  content?: string
  score?: number
  author?: string | null
  createdAt?: string | null
}

export interface LibraryDocument {
  id: string
  title: string
  body: string
  createdAt?: string | null
  author?: string | null
}

export interface SlackSearchInput {
  query?: string
  channel?: string
  user?: string
  from?: string
  to?: string
  limit?: number
}

export interface SlackHitView {
  channelId: string
  channelName: string
  ts: string
  sentAt: string | null
  userDisplayName: string
  text: string
  permalink: string | null
}

export type SlackSearchFn = (
  env: unknown,
  input: SlackSearchInput
) => Promise<{ configured: false } | { configured: true, matches: SlackHitView[] }>

export interface LibraryApi {
  searchDocuments: (
    env: unknown,
    apiKey: string,
    query: string,
    topK: number,
    filters?: SearchFilters
  ) => Promise<{ matches: LibraryMatch[] }>
  getDocument: (env: unknown, id: string) => Promise<LibraryDocument>
  slackSearch?: SlackSearchFn | null
  slackReady?: (env: unknown) => Promise<boolean>
}

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
}

export interface ToolCallResult {
  content: Array<{ type: 'text', text: string }>
  structuredContent?: unknown
  isError?: boolean
}

const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Document id to pass to fetch.' },
          title: { type: 'string' },
          url: { type: 'string', description: 'Canonical URL for citation.' }
        },
        required: ['id', 'title', 'url'],
        additionalProperties: false
      }
    }
  },
  required: ['results'],
  additionalProperties: false
}

const FETCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    text: { type: 'string', description: 'Full document text.' },
    url: { type: 'string', description: 'Canonical URL for citation.' },
    metadata: {
      type: 'object',
      additionalProperties: { type: 'string' }
    }
  },
  required: ['id', 'title', 'text', 'url'],
  additionalProperties: false
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
}

function searchTool () {
  return {
    name: 'search',
    title: 'Search documents',
    description: 'Search the Korwell document library. Pass a natural-language query. Optional limit (1-20), from and to (inclusive UTC dates YYYY-MM-DD), and author narrow the same search. Returns documents, not chunks. Call fetch with a result id for the full text.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural-language search query.' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum documents to return. Defaults to 8.' },
        from: { type: 'string', description: 'Inclusive UTC start date (YYYY-MM-DD).' },
        to: { type: 'string', description: 'Inclusive UTC end date (YYYY-MM-DD).' },
        author: { type: 'string', description: 'Document author. Applied when the library index stores authors.' }
      },
      required: ['query'],
      additionalProperties: false
    },
    outputSchema: SEARCH_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }
}

function fetchTool () {
  return {
    name: 'fetch',
    title: 'Fetch document',
    description: 'Fetch the full text of one Korwell document by the id returned from search.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Document id from search.' }
      },
      required: ['id'],
      additionalProperties: false
    },
    outputSchema: FETCH_OUTPUT_SCHEMA,
    annotations: READ_ONLY
  }
}

function slackTool () {
  return {
    name: 'search_slack',
    title: 'Search Slack archive',
    description: 'Search archived Slack messages. Read-only. Use this for channel conversations, not for documents in the library. search and fetch stay on documents.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to find in archived messages.' },
        channel: { type: 'string', description: 'Channel id or name.' },
        user: { type: 'string', description: 'User id or display name.' },
        from: { type: 'string', description: 'Inclusive UTC start date (YYYY-MM-DD).' },
        to: { type: 'string', description: 'Inclusive UTC end date (YYYY-MM-DD).' },
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      required: ['query'],
      additionalProperties: false
    },
    annotations: READ_ONLY
  }
}

export async function listTools (library: LibraryApi, env: unknown) {
  const tools = [searchTool(), fetchTool()]
  if (!library.slackSearch || !library.slackReady) return tools
  try {
    if (await library.slackReady(env)) tools.push(slackTool())
  } catch (error) {
    console.error(JSON.stringify({
      message: 'mcp_slack_probe_failed',
      error: error instanceof Error ? error.message : String(error)
    }))
  }
  return tools
}

export function documentUrl (origin: string, id: string): string {
  return `${origin.replace(/\/$/, '')}/library?document=${encodeURIComponent(id)}`
}

export function toSearchResults (origin: string, matches: LibraryMatch[], limit: number) {
  const seen = new Set<string>()
  const results: Array<{ id: string, title: string, url: string }> = []
  for (const match of matches) {
    if (!match.documentId || seen.has(match.documentId)) continue
    seen.add(match.documentId)
    results.push({
      id: match.documentId,
      title: match.title || 'Untitled',
      url: documentUrl(origin, match.documentId)
    })
    if (results.length >= limit) break
  }
  return { results }
}

export function toFetchPayload (origin: string, document: LibraryDocument) {
  const metadata: Record<string, string> = { source: 'korwell-documents' }
  if (document.createdAt) metadata.created_at = document.createdAt
  if (document.author) metadata.author = document.author
  return {
    id: document.id,
    title: document.title || 'Untitled',
    text: document.body,
    url: documentUrl(origin, document.id),
    metadata
  }
}

function toolSuccess (payload: unknown): ToolCallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload
  }
}

function toolFailure (message: string): ToolCallResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message.slice(0, 300) }]
  }
}

function argumentRecord (params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') return {}
  const record = params as { arguments?: unknown, args?: unknown }
  const raw = record.arguments ?? record.args ?? {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
}

function textArg (record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function limitArg (value: unknown, fallback: number, max: number): number {
  const requested = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(requested)) return fallback
  return Math.min(max, Math.max(1, Math.trunc(requested)))
}

function errorStatus (error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === 'number' ? status : null
}

function publicMessage (error: unknown, secret: string): string {
  const message = error instanceof Error ? error.message : 'Request failed'
  const redacted = secret ? message.split(secret).join('[redacted]') : message
  return redacted.slice(0, 300)
}

export async function callTool (
  library: LibraryApi,
  env: unknown,
  apiKey: string,
  origin: string,
  name: string,
  params: unknown
): Promise<ToolCallResult> {
  const args = argumentRecord(params)
  try {
    if (name === 'search') {
      const query = textArg(args, 'query')
      const limit = limitArg(args.limit, 8, 20)
      const filters: SearchFilters = {}
      const from = textArg(args, 'from')
      const to = textArg(args, 'to')
      const author = textArg(args, 'author')
      if (from) filters.from = from
      if (to) filters.to = to
      if (author) filters.author = author
      if (!query && !from && !to && !author) return toolFailure('query is required')
      const topK = Math.min(20, Math.max(limit, limit * 3))
      const result = await library.searchDocuments(env, apiKey, query, topK, filters)
      console.log(JSON.stringify({ message: 'mcp_tool', tool: 'search', queryChars: query.length, matches: result.matches.length }))
      return toolSuccess(toSearchResults(origin, result.matches, limit))
    }
    if (name === 'fetch') {
      const id = textArg(args, 'id')
      if (!id) return toolFailure('id is required')
      const document = await library.getDocument(env, id)
      console.log(JSON.stringify({ message: 'mcp_tool', tool: 'fetch', id }))
      return toolSuccess(toFetchPayload(origin, document))
    }
    if (name === 'search_slack') {
      if (!library.slackSearch) return toolFailure('Slack archive search is not available')
      const query = textArg(args, 'query')
      if (!query) return toolFailure('query is required')
      const found = await library.slackSearch(env, {
        query,
        channel: textArg(args, 'channel'),
        user: textArg(args, 'user'),
        from: textArg(args, 'from'),
        to: textArg(args, 'to'),
        limit: limitArg(args.limit, 8, 20)
      })
      if (!found.configured) return toolFailure('Slack archive is not set up yet')
      const results = found.matches.slice(0, limitArg(args.limit, 8, 20)).map(hit => ({
        id: `${hit.channelId}/${hit.ts}`,
        title: `#${hit.channelName} · ${hit.userDisplayName || 'unknown'}`,
        text: hit.text,
        url: hit.permalink || '',
        sentAt: hit.sentAt
      }))
      console.log(JSON.stringify({ message: 'mcp_tool', tool: 'search_slack', queryChars: query.length, matches: results.length }))
      return toolSuccess({ results })
    }
    return toolFailure(`Unknown tool: ${name}`)
  } catch (error) {
    const status = errorStatus(error)
    if (status === 400 || status === 404) return toolFailure(publicMessage(error, apiKey))
    console.error(JSON.stringify({ message: 'mcp_tool_failed', tool: name, error: publicMessage(error, apiKey) }))
    return toolFailure(publicMessage(error, apiKey))
  }
}

export function negotiateProtocol (requested: unknown): string {
  return typeof requested === 'string' && (PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : DEFAULT_PROTOCOL_VERSION
}

export interface ProtocolOutcome {
  status: number
  body: unknown
  protocolVersion?: string
}

export async function handleJsonRpc (
  raw: unknown,
  library: LibraryApi,
  env: unknown,
  apiKey: string,
  origin: string,
  headerVersion: string | null
): Promise<ProtocolOutcome> {
  if (Array.isArray(raw)) {
    return { status: 400, body: rpcError(null, -32600, 'JSON-RPC batches are not supported') }
  }
  if (!raw || typeof raw !== 'object') {
    return { status: 400, body: rpcError(null, -32600, 'Request must be a JSON-RPC object') }
  }
  const message = raw as JsonRpcRequest
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { status: 400, body: rpcError(message.id ?? null, -32600, 'Invalid JSON-RPC request') }
  }
  const protocolVersion = negotiateProtocol(headerVersion)
  if (message.id === undefined) {
    return { status: 202, body: null }
  }

  if (message.method === 'initialize') {
    const params = message.params && typeof message.params === 'object' ? message.params as { protocolVersion?: unknown } : {}
    const version = negotiateProtocol(params.protocolVersion)
    return {
      status: 200,
      protocolVersion: version,
      body: rpcResult(message.id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'korwell-doc-library', version: '1.0.0' },
        instructions: SERVER_INSTRUCTIONS
      })
    }
  }
  if (message.method === 'ping') return { status: 200, protocolVersion, body: rpcResult(message.id, {}) }
  if (message.method === 'tools/list') {
    return { status: 200, protocolVersion, body: rpcResult(message.id, { tools: await listTools(library, env) }) }
  }
  if (message.method === 'tools/call') {
    const params = message.params && typeof message.params === 'object' ? message.params as { name?: unknown } : {}
    const name = typeof params.name === 'string' ? params.name : ''
    if (!name) return { status: 200, protocolVersion, body: rpcResult(message.id, toolFailure('Tool name is required')) }
    const result = await callTool(library, env, apiKey, origin, name, message.params)
    return { status: 200, protocolVersion, body: rpcResult(message.id, result) }
  }
  if (message.method === 'resources/list') return { status: 200, protocolVersion, body: rpcResult(message.id, { resources: [] }) }
  if (message.method === 'prompts/list') return { status: 200, protocolVersion, body: rpcResult(message.id, { prompts: [] }) }
  return { status: 200, protocolVersion, body: rpcError(message.id, -32601, `Method not found: ${message.method}`) }
}

function rpcResult (id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError (id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } }
}
