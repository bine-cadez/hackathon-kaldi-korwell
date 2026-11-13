import { createError, readBody, setResponseHeaders } from 'h3'
import { chatErrorMessage, DEFAULT_CHAT_MODEL, parseChatMessages, runChat, type ChatEvent } from '../utils/chat'
import { getOpenRouterApiKey, readCloudflareEnv, requireEnv } from '../utils/env'
import { defaultLibrary } from '../utils/mcp-library'

// Streams one answer as newline-delimited JSON (see ChatEvent). The site
// password / Access middleware runs before this, like the other /api routes.
export default defineEventHandler(async (event) => {
  let messages
  try {
    messages = parseChatMessages(await readBody(event))
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid chat request', data: { message: error instanceof Error ? error.message : 'Invalid chat request' } })
  }

  const env = requireEnv(event)
  const apiKey = getOpenRouterApiKey(event)
  if (!apiKey) {
    throw createError({
      statusCode: 503,
      statusMessage: 'OPENROUTER_API_KEY is not set',
      data: { message: 'Chat needs OPENROUTER_API_KEY. Set it in .env for local dev, or run wrangler secret put OPENROUTER_API_KEY before deploy.' }
    })
  }
  const model = (readCloudflareEnv(event)?.CHAT_MODEL || process.env.CHAT_MODEL || DEFAULT_CHAT_MODEL).trim()

  const encoder = new TextEncoder()
  const abort = new AbortController()
  const stream = new ReadableStream<Uint8Array>({
    async start (controller) {
      const emit = (chatEvent: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(chatEvent)}\n`))
        } catch {
          // The browser went away; the abort below stops the model call.
        }
      }
      try {
        await runChat({
          messages,
          library: defaultLibrary,
          env,
          apiKey,
          model,
          origin: '',
          today: new Date().toISOString().slice(0, 10),
          emit,
          signal: abort.signal
        })
      } catch (error) {
        if (!abort.signal.aborted) {
          const message = error instanceof Error ? error.message.split(apiKey).join('[redacted]') : String(error)
          console.error(JSON.stringify({ message: 'chat_failed', model, error: message.slice(0, 500) }))
          emit({ type: 'error', message: chatErrorMessage(error, apiKey) })
        }
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed by a cancel.
        }
      }
    },
    cancel () {
      abort.abort()
    }
  })

  setResponseHeaders(event, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-accel-buffering': 'no'
  })
  return stream
})
