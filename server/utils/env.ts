import { createError } from 'h3'
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './embeddings.ts'

export interface D1Statement {
  bind (...values: unknown[]): D1Statement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run (): Promise<unknown>
  first<T>(): Promise<T | null>
}

export interface DocDatabase {
  prepare (query: string): D1Statement
  exec (query: string): Promise<unknown>
  batch (statements: D1Statement[]): Promise<unknown[]>
}

export interface VectorizeVector {
  id: string
  values: number[]
  metadata?: Record<string, string | number | boolean>
}

export interface VectorizeMatch {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

export interface VectorizeIndex {
  upsert (vectors: VectorizeVector[]): Promise<unknown>
  query (vector: number[], options: { topK: number, returnMetadata?: 'all' | 'none' | 'indexed' }): Promise<{ matches?: VectorizeMatch[] }>
  deleteByIds (ids: string[]): Promise<unknown>
}

export interface R2ObjectBody {
  body: ReadableStream
  size: number
  httpMetadata?: { contentType?: string }
}

export interface R2Bucket {
  put (key: string, value: string | Uint8Array | ArrayBuffer, options?: {
    httpMetadata?: { contentType?: string }
    customMetadata?: Record<string, string>
  }): Promise<unknown>
  get (key: string): Promise<R2ObjectBody | null>
  list (options: { prefix: string, cursor?: string }): Promise<{ objects: Array<{ key: string }>, truncated: boolean, cursor?: string }>
  delete (keys: string | string[]): Promise<void>
}

export interface MarkdownDocument {
  name: string
  blob: Blob
}

export interface ConversionResult {
  name: string
  format: 'markdown' | 'text' | 'error'
  mimetype?: string
  tokens?: number
  data?: string
  error?: string
}

export interface WorkersAI {
  toMarkdown (
    files: MarkdownDocument | MarkdownDocument[],
    options?: { conversionOptions?: { pdf?: { metadata?: boolean } } }
  ): Promise<ConversionResult | ConversionResult[]>
}

export interface DocLibraryEnv {
  DB: DocDatabase
  VECTORIZE: VectorizeIndex
  BLOB?: R2Bucket
  AI?: WorkersAI
  OPENROUTER_API_KEY?: string
  /** OpenRouter model id for /api/chat. Defaults to DEFAULT_CHAT_MODEL. */
  CHAT_MODEL?: string
  SITE_PASSWORD?: string
  SLACK_SIGNING_SECRET?: string
  SLACK_BOT_TOKEN?: string
  SLACK_CHANNEL_IDS?: string
}

export function readCloudflareEnv (event: { context: { cloudflare?: { env?: DocLibraryEnv } } }): DocLibraryEnv | undefined {
  return event.context.cloudflare?.env
}

export function requireDatabase (event: { context: { cloudflare?: { env?: DocLibraryEnv } } }): DocDatabase {
  const db = readCloudflareEnv(event)?.DB
  if (!db) {
    throw createError({
      statusCode: 503,
      statusMessage: 'D1 binding is unavailable',
      data: { message: 'DB binding is missing. Run npm run dev or deploy the Worker after creating the D1 database.' }
    })
  }
  return db
}

export function requireEnv (event: { context: { cloudflare?: { env?: DocLibraryEnv } } }): DocLibraryEnv {
  const env = readCloudflareEnv(event)
  if (!env?.DB || !env?.VECTORIZE) {
    throw createError({
      statusCode: 503,
      statusMessage: 'D1 and Vectorize bindings are unavailable',
      data: {
        message: 'DB and VECTORIZE bindings are missing. Run npm run dev (cloudflare_module preset) or deploy the Worker after creating the D1 database and Vectorize index.'
      }
    })
  }
  return env
}

export function getOpenRouterApiKey (event: { context: { cloudflare?: { env?: DocLibraryEnv } } }): string {
  const fromBinding = readCloudflareEnv(event)?.OPENROUTER_API_KEY
  const fromProcess = process.env.OPENROUTER_API_KEY
  const fromConfig = useRuntimeConfig(event).openrouterApiKey
  return (fromBinding || fromProcess || fromConfig || '').trim()
}

export function requireOpenRouterApiKey (event: { context: { cloudflare?: { env?: DocLibraryEnv } } }): string {
  if (import.meta.dev && process.env.EMBEDDINGS_FIXTURE === '1') return ''
  const apiKey = getOpenRouterApiKey(event)
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OPENROUTER_API_KEY is not set',
      data: {
        message: 'Set OPENROUTER_API_KEY in .env for local dev, or run wrangler secret put OPENROUTER_API_KEY before deploy. Embeddings use ' + EMBEDDING_MODEL + ' (' + EMBEDDING_DIMENSIONS + ' dimensions).'
      }
    })
  }
  return apiKey
}

export function toHttpError (error: unknown) {
  if (error && typeof error === 'object' && 'statusCode' in error) return error
  const message = error instanceof Error ? error.message : 'Unexpected error'
  const statusCode = message.includes('OPENROUTER_API_KEY') ? 503 : 502
  console.error(JSON.stringify({ message: 'request_failed', error: message }))
  return createError({
    statusCode,
    statusMessage: message.slice(0, 180),
    data: { message }
  })
}
