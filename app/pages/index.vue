<script setup lang="ts">
interface ChatSource {
  kind: 'document' | 'slack'
  title: string
  url: string
  detail?: string
}

interface ToolActivity {
  id: string
  name: string
  input: Record<string, unknown>
  done: boolean
  ok: boolean
  count: number
  title?: string
}

interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolActivity[]
  sources: ChatSource[]
  status: 'streaming' | 'done' | 'stopped' | 'error'
  error?: unknown
}

type ChatEvent =
  | { type: 'text', text: string }
  | { type: 'tool_call', id: string, name: string, input: Record<string, unknown> }
  | { type: 'tool_result', id: string, name: string, ok: boolean, count: number, sources: ChatSource[] }
  | { type: 'done' }
  | { type: 'error', message: string }

useHead({ title: 'Ask' })

const suggestions = [
  'What did we decide in the last project kickoff?',
  'Summarise what was discussed on Slack last week',
  'Which documents mention the launch checklist?'
]

// useState keeps the conversation while you open a cited document and come back.
const turns = useState<ChatTurn[]>('korwell-chat', () => [])
const draft = ref('')
const streaming = ref(false)
const composer = ref<{ focus: () => void } | null>(null)
const end = ref<HTMLElement | null>(null)
let controller: AbortController | null = null

const newId = () => Math.random().toString(36).slice(2)

// Pairs whose answer failed or came back empty are left out, so the model
// never sees two user turns in a row.
function history () {
  const messages: Array<{ role: 'user' | 'assistant', content: string }> = []
  const list = turns.value
  for (let index = 0; index < list.length; index += 1) {
    const turn = list[index]!
    if (turn.role !== 'user') continue
    const answer = list[index + 1]
    if (answer?.role === 'assistant') {
      if (!answer.text.trim()) continue
      messages.push({ role: 'user', content: turn.text }, { role: 'assistant', content: answer.text })
    } else {
      messages.push({ role: 'user', content: turn.text })
    }
  }
  return messages
}

function nearBottom () {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160
}

async function keepScrolled (follow: boolean) {
  if (!follow) return
  await nextTick()
  end.value?.scrollIntoView({ block: 'end' })
}

async function readError (response: Response) {
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    // Not JSON; the status is enough.
  }
  const record = (data && typeof data === 'object' ? data : {}) as { statusMessage?: string, message?: string, data?: { message?: string } }
  return { statusCode: response.status, statusMessage: record.statusMessage, data: { message: record.data?.message || record.message || record.statusMessage } }
}

function apply (turn: ChatTurn, event: ChatEvent) {
  if (event.type === 'text') {
    turn.text += event.text
  } else if (event.type === 'tool_call') {
    turn.tools.push({ id: event.id, name: event.name, input: event.input, done: false, ok: true, count: 0 })
  } else if (event.type === 'tool_result') {
    const tool = turn.tools.find(item => item.id === event.id)
    if (tool) {
      tool.done = true
      tool.ok = event.ok
      tool.count = event.count
      if (event.name === 'fetch') tool.title = event.sources[0]?.title
    }
    for (const source of event.sources) {
      if (source.url && !turn.sources.some(known => known.url === source.url)) turn.sources.push(source)
    }
  } else if (event.type === 'done') {
    turn.status = 'done'
  } else if (event.type === 'error') {
    turn.status = 'error'
    turn.error = { statusCode: 502, data: { message: event.message } }
  }
}

async function ask (question: string) {
  const text = question.trim()
  if (!text || streaming.value) return
  draft.value = ''
  turns.value.push({ id: newId(), role: 'user', text, tools: [], sources: [], status: 'done' })
  const messages = history()
  turns.value.push({ id: newId(), role: 'assistant', text: '', tools: [], sources: [], status: 'streaming' })
  // Mutate through the reactive array so every change re-renders.
  const turn = turns.value.at(-1)!
  streaming.value = true
  controller = new AbortController()
  keepScrolled(true)

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: controller.signal
    })
    if (!response.ok || !response.body) throw await readError(response)

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      const follow = nearBottom()
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          apply(turn, JSON.parse(line) as ChatEvent)
        } catch {
          // Skip a garbled line.
        }
      }
      keepScrolled(follow)
      if (done) break
    }
    if (turn.status === 'streaming') turn.status = 'done'
  } catch (error) {
    if (controller?.signal.aborted) {
      turn.status = 'stopped'
    } else {
      turn.status = 'error'
      turn.error = error
    }
  } finally {
    streaming.value = false
    controller = null
    await nextTick()
    composer.value?.focus()
  }
}

function stop () {
  controller?.abort()
}

function retry () {
  const last = turns.value.at(-1)
  const question = turns.value.at(-2)
  if (last?.role !== 'assistant' || question?.role !== 'user') return
  turns.value.splice(-2, 2)
  ask(question.text)
}

function newChat () {
  stop()
  turns.value = []
  draft.value = ''
  nextTick(() => composer.value?.focus())
}

function quoted (value: unknown) {
  return typeof value === 'string' && value ? `“${value}”` : ''
}

function toolLabel (tool: ToolActivity) {
  const { input } = tool
  if (tool.name === 'fetch') return tool.done ? (tool.ok ? `Read ${quoted(tool.title) || 'a document'}` : 'Couldn’t open a document') : 'Reading a document…'
  const where = tool.name === 'search_slack' ? 'Slack' : 'documents'
  const what = quoted(input.query) || quoted(input.author)
  const channel = tool.name === 'search_slack' && typeof input.channel === 'string' && input.channel ? ` in #${input.channel.replace(/^#/, '')}` : ''
  const range = typeof input.from === 'string' || typeof input.to === 'string' ? ` · ${input.from || '…'} – ${input.to || '…'}` : ''
  const base = `Searched ${where}${what ? ` for ${what}` : ''}${channel}${range}`
  if (!tool.done) return `${base}…`
  if (!tool.ok) return `${base} · failed`
  return `${base} · ${tool.count} ${tool.count === 1 ? 'result' : 'results'}`
}

// URLs the tools returned for this answer. Only these external links are clickable.
function sourceUrls (turn: ChatTurn) {
  return new Set(turn.sources.map(source => source.url))
}

// Only list the sources the answer actually links to.
function citedSources (turn: ChatTurn) {
  return turn.sources.filter(source => turn.text.includes(`](${source.url})`))
}

// Answer links to the app open with the router instead of reloading the page.
function onAnswerClick (event: MouseEvent) {
  const link = (event.target as HTMLElement | null)?.closest('a')
  const href = link?.getAttribute('href')
  if (!href || !href.startsWith('/') || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
  event.preventDefault()
  navigateTo(href)
}

// Each question with its answer, shown side by side.
const pairs = computed(() => turns.value.flatMap((turn, index) => {
  if (turn.role !== 'user') return []
  const next = turns.value[index + 1]
  return [{ question: turn, answer: next?.role === 'assistant' ? next : null, last: index >= turns.value.length - 2 }]
}))

// The logo eye in the header blinks faster while Korwell answers.
const asking = useState('korwell-asking', () => false)
watch(streaming, (value) => { asking.value = value })

onMounted(() => {
  composer.value?.focus()
  if (turns.value.length) end.value?.scrollIntoView({ block: 'end' })
})
onBeforeUnmount(() => {
  stop()
  asking.value = false
})
</script>

<template>
  <main class="flex flex-col">
    <section v-if="!turns.length" class="flex flex-1 flex-col items-center justify-center px-4 pt-16 pb-20 text-center" aria-labelledby="ask-title">
      <h1 id="ask-title" class="text-[clamp(2.4rem,6vw,3.6rem)] leading-tight font-light">What do you want to know?</h1>
      <p class="mt-3 max-w-xl text-lg leading-relaxed text-muted">Korwell searches Kaldi’s documents and Slack, and links every answer to its sources.</p>
      <ChatComposer
        ref="composer"
        v-model="draft"
        large
        class="mt-10 w-[min(46rem,100%)] text-left"
        :streaming="streaming"
        placeholder="Ask about a project, a decision, a person…"
        @submit="ask(draft)"
        @stop="stop"
      />
      <ul class="mt-5 flex max-w-3xl flex-wrap justify-center gap-2" aria-label="Example questions">
        <li v-for="suggestion in suggestions" :key="suggestion">
          <UButton
            color="neutral"
            variant="outline"
            class="bg-transparent font-light hover:bg-transparent hover:text-primary hover:ring-primary"
            :ui="{ label: 'whitespace-normal text-start' }"
            :label="suggestion"
            @click="ask(suggestion)"
          />
        </li>
      </ul>
    </section>

    <template v-else>
      <ol class="flex-1" aria-live="polite">
        <li v-for="pair in pairs" :key="pair.question.id" class="studio-section border-b border-default last:border-b-0">
          <h2 class="self-start text-[1.6rem] leading-snug font-light whitespace-pre-wrap [overflow-wrap:anywhere] lg:sticky lg:top-6">{{ pair.question.text }}</h2>

          <article v-if="pair.answer" class="min-w-0 max-w-3xl" :aria-busy="pair.answer.status === 'streaming'">
            <ul v-if="pair.answer.tools.length" class="mb-4 grid gap-1" aria-label="What Korwell looked up">
              <li
                v-for="tool in pair.answer.tools"
                :key="tool.id"
                class="flex items-baseline gap-2 [overflow-wrap:anywhere]"
                :class="tool.done && !tool.ok ? 'text-error' : 'text-muted'"
              >
                <UIcon
                  :name="tool.name === 'fetch' ? 'i-lucide-file-text' : tool.name === 'search_slack' ? 'i-lucide-hash' : 'i-lucide-search'"
                  class="size-4 flex-none self-center text-primary"
                  :class="{ 'chat-pulse': !tool.done }"
                />
                {{ toolLabel(tool) }}
              </li>
            </ul>

            <div
              v-if="pair.answer.text"
              class="chat-answer-body"
              @click="onAnswerClick"
              v-html="renderChatMarkdown(pair.answer.text, sourceUrls(pair.answer))"
            />
            <p v-else-if="pair.answer.status === 'streaming'" class="my-2 flex gap-1.5" role="status">
              <span class="chat-pulse size-2 rounded-full bg-orange" />
              <span class="chat-pulse size-2 rounded-full bg-orange [animation-delay:0.15s]" />
              <span class="chat-pulse size-2 rounded-full bg-orange [animation-delay:0.3s]" />
              <span class="sr-only">Korwell is thinking…</span>
            </p>

            <ol
              v-if="pair.answer.status !== 'streaming' && citedSources(pair.answer).length"
              class="mt-5 grid list-decimal gap-1.5 border-t border-default pt-4 pl-5 marker:font-semibold marker:text-primary"
              aria-label="Sources"
            >
              <li v-for="source in citedSources(pair.answer)" :key="source.url" class="pl-1">
                <NuxtLink v-if="source.url.startsWith('/')" class="text-link underline decoration-flame-300 underline-offset-[0.2em]" :to="source.url">{{ source.title }}</NuxtLink>
                <a v-else class="text-link underline decoration-flame-300 underline-offset-[0.2em]" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
                <span class="text-muted">
                  {{ source.kind === 'slack' ? ' Slack' : ' Document' }}<template v-if="source.detail">, {{ source.detail }}</template>
                </span>
              </li>
            </ol>

            <p v-if="pair.answer.status === 'stopped'" class="mt-2 text-sm text-muted">Stopped.</p>
            <ErrorState
              v-if="pair.answer.status === 'error'"
              :error="pair.answer.error"
              title="Korwell couldn’t answer"
              compact
              v-bind="pair.last && !streaming ? { onRetry: retry } : {}"
            />
          </article>
        </li>
      </ol>
      <div ref="end" class="h-px" />

      <div class="studio-section sticky bottom-0 items-end bg-linear-to-b from-transparent to-paper to-[1.25rem] pt-6 pb-5">
        <UButton class="hidden justify-self-start uppercase lg:inline-flex" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" label="New chat" @click="newChat" />
        <div class="flex items-end gap-2">
          <UButton class="lg:hidden" color="neutral" variant="outline" icon="i-lucide-plus" square aria-label="New chat" title="New chat" @click="newChat" />
          <ChatComposer
            ref="composer"
            v-model="draft"
            class="max-w-3xl flex-1"
            :streaming="streaming"
            placeholder="Ask a follow-up…"
            @submit="ask(draft)"
            @stop="stop"
          />
        </div>
      </div>
    </template>
  </main>
</template>
