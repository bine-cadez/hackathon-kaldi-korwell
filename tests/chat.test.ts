import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderChatMarkdown, safeHref } from '../app/utils/chatMarkdown.ts'
import {
  CHAT_ENDPOINT,
  chatErrorMessage,
  ChatUpstreamError,
  FETCH_CHARS,
  MAX_STEPS,
  parseChatMessages,
  readSse,
  runChat,
  toolMessageContent,
  type ChatEvent
} from '../server/utils/chat.ts'
import type { LibraryApi } from '../server/utils/mcp-protocol.ts'

function sseBody (chunks: unknown[], split = 7): ReadableStream<Uint8Array> {
  const text = [': OPENROUTER PROCESSING', ...chunks.map(chunk => `data: ${JSON.stringify(chunk)}`), 'data: [DONE]', ''].join('\n')
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start (controller) {
      // Odd-sized pieces so lines and multi-byte characters split across reads.
      for (let offset = 0; offset < bytes.length; offset += split) controller.enqueue(bytes.slice(offset, offset + split))
      controller.close()
    }
  })
}

function textChunks (text: string) {
  return text.split(' ').map((word, index) => ({ choices: [{ delta: { content: index ? ` ${word}` : word } }] }))
}

function toolCallChunks (calls: Array<{ id: string, name: string, args: unknown }>) {
  return calls.flatMap((call, index) => {
    const args = JSON.stringify(call.args)
    const half = Math.floor(args.length / 2)
    return [
      { choices: [{ delta: { tool_calls: [{ index, id: call.id, type: 'function', function: { name: call.name, arguments: args.slice(0, half) } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index, function: { arguments: args.slice(half) } }] } }] }
    ]
  })
}

function fakeLibrary (): LibraryApi & { searches: unknown[][] } {
  const searches: unknown[][] = []
  return {
    searches,
    searchDocuments: async (...args: unknown[]) => {
      searches.push(args)
      return {
        matches: [
          { documentId: 'doc-1', title: 'Kickoff notes', content: 'We agreed to ship in May.', author: 'Ana', createdAt: '2026-03-02T10:00:00.000Z' },
          { documentId: 'doc-1', title: 'Kickoff notes', content: 'Second chunk' },
          { documentId: 'doc-2', title: 'Budget', content: 'Budget is 10k.' }
        ]
      }
    },
    getDocument: async (_env: unknown, id: string) => ({ id, title: 'Kickoff notes', body: 'x'.repeat(FETCH_CHARS + 50) })
  }
}

interface Recorded { body: { messages: Array<Record<string, unknown>>, tools: Array<{ function: { name: string } }>, tool_choice: string, model: string } }

function fakeFetch (responses: Array<() => Response>) {
  const calls: Recorded[] = []
  // Like workerd's fetch: refuse to run as a method of some other object.
  const impl = (async function (this: unknown, url: string, init: RequestInit) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation: function called with incorrect `this` reference.')
    assert.equal(url, CHAT_ENDPOINT)
    calls.push({ body: JSON.parse(String(init.body)) })
    const next = responses.shift()
    assert.ok(next, 'unexpected extra model call')
    return next()
  }) as unknown as typeof fetch
  return { impl, calls }
}

const stream = (chunks: unknown[]) => () => new Response(sseBody(chunks), { status: 200 })

test('readSse yields JSON payloads and skips comments and [DONE]', async () => {
  const payloads: unknown[] = []
  for await (const payload of readSse(sseBody([{ a: 'č' }, { b: 2 }], 3))) payloads.push(payload)
  assert.deepEqual(payloads, [{ a: 'č' }, { b: 2 }])
})

test('runChat searches, reads tool results back, and streams the answer', async () => {
  const library = fakeLibrary()
  const { impl, calls } = fakeFetch([
    stream(toolCallChunks([{ id: 'call_a', name: 'search', args: { query: 'kickoff decision', from: '2026-03-01' } }])),
    stream(textChunks('We ship in May ([Kickoff notes](/library?document=doc-1)).'))
  ])
  const events: ChatEvent[] = []
  await runChat({
    messages: [{ role: 'user', content: 'What did we decide at kickoff?' }],
    library,
    env: {},
    apiKey: 'key',
    model: 'test/model',
    origin: '',
    today: '2026-11-13',
    emit: event => events.push(event),
    fetchImpl: impl
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.body.model, 'test/model')
  assert.deepEqual(calls[0]!.body.tools.map(tool => tool.function.name), ['search', 'fetch'])
  assert.match(String(calls[0]!.body.messages[0]!.content), /Today is 2026-11-13/)
  assert.match(String(calls[0]!.body.messages[0]!.content), /Slack archive is not set up/)

  // The search ran with the model's arguments.
  assert.equal(library.searches.length, 1)
  assert.equal(library.searches[0]![2], 'kickoff decision')
  assert.deepEqual(library.searches[0]![4], { from: '2026-03-01' })

  // The second call carries the assistant tool call and the tool result with snippets.
  const second = calls[1]!.body.messages
  const assistant = second.at(-2)!
  assert.equal(assistant.role, 'assistant')
  assert.deepEqual((assistant.tool_calls as Array<{ id: string }>).map(call => call.id), ['call_a'])
  const tool = second.at(-1)!
  assert.equal(tool.role, 'tool')
  assert.equal(tool.tool_call_id, 'call_a')
  const results = JSON.parse(String(tool.content)).results
  assert.deepEqual(results[0], { id: 'doc-1', title: 'Kickoff notes', url: '/library/doc-1', snippet: 'We agreed to ship in May.', author: 'Ana', createdAt: '2026-03-02' })
  assert.equal(results.length, 2)

  assert.deepEqual(events.slice(0, 2), [
    { type: 'tool_call', id: 'call_a', name: 'search', input: { query: 'kickoff decision', from: '2026-03-01' } },
    {
      type: 'tool_result',
      id: 'call_a',
      name: 'search',
      ok: true,
      count: 2,
      sources: [
        { kind: 'document', title: 'Kickoff notes', url: '/library/doc-1', detail: '2026-03-02' },
        { kind: 'document', title: 'Budget', url: '/library/doc-2', detail: undefined }
      ]
    }
  ])
  const text = events.filter(event => event.type === 'text').map(event => (event as { text: string }).text).join('')
  assert.equal(text, 'We ship in May ([Kickoff notes](/library?document=doc-1)).')
  assert.deepEqual(events.at(-1), { type: 'done' })
})

test('runChat forbids tools on the last step so the model must answer', async () => {
  const responses = Array.from({ length: MAX_STEPS - 1 }, (_, index) => stream(toolCallChunks([{ id: `call_${index}`, name: 'search', args: { query: `try ${index}` } }])))
  responses.push(stream(textChunks('Nothing found.')))
  const { impl, calls } = fakeFetch(responses)
  const events: ChatEvent[] = []
  await runChat({ messages: [{ role: 'user', content: 'hm' }], library: fakeLibrary(), env: {}, apiKey: 'k', model: 'm', origin: '', today: '2026-11-13', emit: event => events.push(event), fetchImpl: impl })
  assert.equal(calls.length, MAX_STEPS)
  assert.deepEqual(calls.map(call => call.body.tool_choice), [...Array(MAX_STEPS - 1).fill('auto'), 'none'])
  assert.deepEqual(events.at(-1), { type: 'done' })
})

test('runChat separates text from different model turns', async () => {
  const { impl } = fakeFetch([
    stream([...textChunks('Let me look.'), ...toolCallChunks([{ id: 'c1', name: 'search', args: { query: 'x' } }])]),
    stream(textChunks('Found it.'))
  ])
  const events: ChatEvent[] = []
  await runChat({ messages: [{ role: 'user', content: 'q' }], library: fakeLibrary(), env: {}, apiKey: 'k', model: 'm', origin: '', today: '2026-11-13', emit: event => events.push(event), fetchImpl: impl })
  const text = events.filter(event => event.type === 'text').map(event => (event as { text: string }).text).join('')
  assert.equal(text, 'Let me look.\n\nFound it.')
})

test('runChat throws an upstream error with the HTTP status', async () => {
  const { impl } = fakeFetch([() => new Response('{"error":{"message":"no credits"}}', { status: 402 })])
  await assert.rejects(
    runChat({ messages: [{ role: 'user', content: 'q' }], library: fakeLibrary(), env: {}, apiKey: 'k', model: 'm', origin: '', today: '2026-11-13', emit: () => {}, fetchImpl: impl }),
    (error: unknown) => error instanceof ChatUpstreamError && error.status === 402
  )
  assert.equal(chatErrorMessage(new ChatUpstreamError(402, 'x')), 'The OpenRouter account is out of credits.')
  assert.equal(chatErrorMessage(new TypeError('boom sk-or-123'), 'sk-or-123'), 'The answer could not be finished (TypeError: boom [redacted]). Try again.')
})

test('chat errors carry OpenRouter\'s reason, from the response or mid-stream', async () => {
  const body = '{"error":{"message":"Provider returned error","code":502,"metadata":{"provider_name":"Anthropic","raw":"overloaded"}}}'
  const http = fakeFetch([() => new Response(body, { status: 502 })])
  const fromHttp = await runChat({ messages: [{ role: 'user', content: 'q' }], library: fakeLibrary(), env: {}, apiKey: 'k', model: 'm', origin: '', today: '2026-11-13', emit: () => {}, fetchImpl: http.impl }).catch(error => error)
  assert.equal(chatErrorMessage(fromHttp), 'OpenRouter error 502. OpenRouter said: Provider returned error · provider Anthropic · overloaded')

  const midStream = fakeFetch([stream([...textChunks('Partial'), { error: { message: 'No endpoints found', code: 404 } }])])
  const fromStream = await runChat({ messages: [{ role: 'user', content: 'q' }], library: fakeLibrary(), env: {}, apiKey: 'k', model: 'm', origin: '', today: '2026-11-13', emit: () => {}, fetchImpl: midStream.impl }).catch(error => error)
  assert.equal(chatErrorMessage(fromStream), 'The chat model rejected the request (404). OpenRouter said: No endpoints found')
})

test('toolMessageContent cuts long documents and marks errors', () => {
  const long = { id: 'd', title: 't', text: 'y'.repeat(FETCH_CHARS + 10), url: '/x' }
  const content = JSON.parse(toolMessageContent('fetch', { content: [{ type: 'text', text: JSON.stringify(long) }], structuredContent: long }))
  assert.equal(content.text.length, FETCH_CHARS)
  assert.equal(content.truncated, true)
  assert.equal(toolMessageContent('search', { isError: true, content: [{ type: 'text', text: 'query is required' }] }), 'Error: query is required')
})

test('parseChatMessages validates roles, trims history, and needs a user last', () => {
  assert.deepEqual(parseChatMessages({ messages: [
    { role: 'assistant', content: 'Hi there' },
    { role: 'user', content: '  hello  ' },
    { role: 'assistant', content: '' },
    { role: 'user', content: 'again' }
  ] }), [{ role: 'user', content: 'hello' }, { role: 'user', content: 'again' }])
  assert.throws(() => parseChatMessages({ messages: [] }))
  assert.throws(() => parseChatMessages({ messages: [{ role: 'system', content: 'x' }] }))
  assert.throws(() => parseChatMessages({ messages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }] }))
  const many = Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `m${index}` }))
  many.push({ role: 'user', content: 'last' })
  const parsed = parseChatMessages({ messages: many })
  assert.ok(parsed.length <= 30)
  assert.equal(parsed[0]!.role, 'user')
  assert.equal(parsed.at(-1)!.content, 'last')
})

test('renderChatMarkdown escapes HTML and only allows safe links', () => {
  const allowed = new Set(['https://kaldi.slack.com/archives/C1/p1'])
  const html = renderChatMarkdown('<img src=x onerror=alert(1)> **bold** [doc](/library?document=doc-1) [bad](javascript:alert(1)) [ext](https://kaldi.slack.com/archives/C1/p1)', allowed)
  assert.ok(!html.includes('<img'))
  assert.ok(html.includes('&lt;img'))
  assert.ok(html.includes('<strong>bold</strong>'))
  assert.ok(html.includes('<a href="/library?document=doc-1">doc</a>'))
  assert.ok(!html.includes('href="javascript'))
  assert.ok(html.includes('<a href="https://kaldi.slack.com/archives/C1/p1" target="_blank" rel="noopener noreferrer">ext</a>'))
  assert.equal(safeHref('//evil.example'), null)
  assert.equal(safeHref('"/><script>'), null)
})

test('renderChatMarkdown does not link URLs the tools did not return', () => {
  // A prompt-injected document could ask the model to leak the chat in a link.
  const html = renderChatMarkdown('[Click to verify](https://evil.example/?q=secret+plans) [app](/authorize?client_id=x) [doc](/library?document=a&next=https://evil.example)')
  assert.ok(!html.includes('<a'))
  assert.ok(html.includes('[Click to verify](https://evil.example/?q=secret+plans)'))
  assert.equal(safeHref('/library?document=doc-1'), '/library?document=doc-1')
  // Document pages, the current citation form.
  assert.equal(safeHref('/library/doc-1'), '/library/doc-1')
  assert.equal(safeHref('/library/doc-1/../../authorize'), null)
  assert.equal(safeHref('/library/doc-1?next=https://evil.example'), null)
  assert.equal(safeHref('https://kaldi.slack.com/x'), null)
  assert.equal(safeHref('https://kaldi.slack.com/x', new Set(['https://kaldi.slack.com/x'])), 'https://kaldi.slack.com/x')
})

test('renderChatMarkdown renders lists, headings, paragraphs and code', () => {
  assert.equal(
    renderChatMarkdown('## Summary\nFirst line\nsecond line\n\n- one\n- `two`\n\n1. a\n2. b\n\n```\n<x>\n```'),
    '<h3>Summary</h3><p>First line<br>second line</p><ul><li>one</li><li><code>two</code></li></ul><ol><li>a</li><li>b</li></ol><pre><code>&lt;x&gt;</code></pre>'
  )
})
