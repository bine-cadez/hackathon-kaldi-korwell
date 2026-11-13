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

useHead({ title: 'Ask · The Kaldi Archive' })

const suggestions = [
  'What did we decide in the last project kickoff?',
  'Summarise what was discussed on Slack last week',
  'Which documents mention the launch checklist?'
]

// useState keeps the conversation while you open a cited document and come back.
const turns = useState<ChatTurn[]>('korwell-chat', () => [])
const draft = ref('')
const streaming = ref(false)
const composer = ref<{ textareaRef: HTMLTextAreaElement | null } | null>(null)
const input = computed(() => composer.value?.textareaRef ?? null)
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
    input.value?.focus()
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
  input.value?.focus()
}

function onKeydown (event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    ask(draft.value)
  }
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

onMounted(() => {
  input.value?.focus()
  if (turns.value.length) end.value?.scrollIntoView({ block: 'end' })
})
onBeforeUnmount(stop)
</script>

<template>
  <main class="mx-auto flex w-[min(46rem,calc(100%-2rem))] flex-col pt-6" :class="{ 'justify-center': !turns.length }">
    <section v-if="!turns.length" class="pt-4 pb-6 text-center" aria-labelledby="chat-title">
      <ArchiveEye class="w-[clamp(7rem,22vw,10rem)]" :searching="streaming" />
      <p class="eyebrow">Ask the archive</p>
      <h1 id="chat-title" class="mb-3 text-[clamp(3.2rem,10vw,5.5rem)] leading-none text-primary">Korwell</h1>
      <p class="mx-auto mb-6 max-w-2xl text-muted">Ask anything about Kaldi’s documents and Slack. Korwell searches the archive and links every answer to its sources.</p>
    </section>

    <div v-else class="flex justify-end">
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-square-pen" label="New chat" @click="newChat" />
    </div>

    <ol v-if="turns.length" class="mt-4 grid gap-4" aria-live="polite">
      <li v-for="(turn, index) in turns" :key="turn.id" :class="{ 'flex justify-end': turn.role === 'user' }">
        <p v-if="turn.role === 'user'" class="m-0 max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 leading-snug whitespace-pre-wrap text-paper [overflow-wrap:anywhere]">{{ turn.text }}</p>
        <article v-else class="rounded-2xl rounded-tl-sm border border-default bg-default px-4.5 py-3.5 shadow-xs" :aria-busy="turn.status === 'streaming'">
          <ul v-if="turn.tools.length" class="mb-2.5 grid gap-1" aria-label="What Korwell looked up">
            <li
              v-for="tool in turn.tools"
              :key="tool.id"
              class="flex items-baseline gap-2 text-sm [overflow-wrap:anywhere]"
              :class="!tool.done ? 'text-primary' : !tool.ok ? 'text-error' : 'text-muted'"
            >
              <UIcon
                :name="tool.name === 'fetch' ? 'i-lucide-file-text' : tool.name === 'search_slack' ? 'i-lucide-message-square' : 'i-lucide-search'"
                class="size-3.5 flex-none self-center"
                :class="{ 'chat-pulse': !tool.done }"
              />
              {{ toolLabel(tool) }}
            </li>
          </ul>

          <div
            v-if="turn.text"
            class="chat-answer-body"
            :class="{ 'border-t border-default pt-2.5': turn.tools.length }"
            @click="onAnswerClick"
            v-html="renderChatMarkdown(turn.text, sourceUrls(turn))"
          />
          <p v-else-if="turn.status === 'streaming'" class="my-1 flex gap-1.5" role="status">
            <span class="chat-pulse size-2 rounded-full bg-orange" />
            <span class="chat-pulse size-2 rounded-full bg-orange [animation-delay:0.15s]" />
            <span class="chat-pulse size-2 rounded-full bg-orange [animation-delay:0.3s]" />
            <span class="sr-only">Korwell is thinking…</span>
          </p>

          <div v-if="turn.status !== 'streaming' && citedSources(turn).length" class="mt-3.5 border-t border-dashed border-default pt-3">
            <p class="eyebrow mb-1.5">Sources</p>
            <ul class="grid gap-1.5 text-sm">
              <li v-for="source in citedSources(turn)" :key="source.url" class="flex flex-wrap items-center gap-x-1.5">
                <UBadge color="neutral" variant="outline" size="sm" class="min-w-12 justify-center uppercase" :label="source.kind === 'slack' ? 'Slack' : 'Doc'" />
                <NuxtLink v-if="source.url.startsWith('/')" class="text-primary underline" :to="source.url">{{ source.title }}</NuxtLink>
                <a v-else class="text-primary underline" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }}</a>
                <span v-if="source.detail" class="text-muted">· {{ source.detail }}</span>
              </li>
            </ul>
          </div>

          <p v-if="turn.status === 'stopped'" class="mt-2 text-sm text-muted">Stopped.</p>
          <ErrorState
            v-if="turn.status === 'error'"
            :error="turn.error"
            title="Korwell couldn’t answer"
            compact
            v-bind="index === turns.length - 1 && !streaming ? { onRetry: retry } : {}"
          />
        </article>
      </li>
    </ol>
    <div ref="end" class="h-px" />

    <form
      class="flex items-end gap-2"
      :class="turns.length ? 'sticky bottom-0 mt-auto bg-linear-to-b from-transparent to-paper to-[1rem] pt-4 pb-5' : ''"
      @submit.prevent="ask(draft)"
    >
      <label class="sr-only" for="chat-input">Ask Korwell</label>
      <UTextarea
        id="chat-input"
        ref="composer"
        v-model="draft"
        class="flex-1"
        :rows="1"
        autoresize
        :maxrows="8"
        size="xl"
        maxlength="8000"
        enterkeyhint="send"
        placeholder="Ask about a project, a decision, a person…"
        :ui="{ base: 'resize-none rounded-xl ring-primary' }"
        @keydown="onKeydown"
      />
      <UButton v-if="streaming" type="button" icon="i-lucide-square" size="xl" square aria-label="Stop answering" title="Stop" @click="stop" />
      <UButton v-else type="submit" icon="i-lucide-search" size="xl" square :disabled="!draft.trim()" aria-label="Ask Korwell" title="Ask Korwell (Enter)" />
    </form>
    <ul v-if="!turns.length" class="mt-4 mb-8 flex flex-wrap justify-center gap-2" aria-label="Example questions">
      <li v-for="suggestion in suggestions" :key="suggestion">
        <UButton color="neutral" variant="outline" class="bg-default text-primary" :ui="{ label: 'whitespace-normal text-start' }" :label="suggestion" @click="ask(suggestion)" />
      </li>
    </ul>
  </main>
</template>
