<script setup lang="ts">
import type { ChatSource, ChatTurn } from '~/composables/useChatHistory'

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
const { turns, chatId, resets } = useCurrentChat()
const history = useChatHistory()
const historyOpen = ref(false)
const draft = ref('')
const streaming = ref(false)
const composer = ref<{ focus: () => void } | null>(null)
const end = ref<HTMLElement | null>(null)
let controller: AbortController | null = null

const newId = () => Math.random().toString(36).slice(2)

// Pairs whose answer failed or came back empty are left out, so the model
// never sees two user turns in a row.
function priorMessages () {
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
  const messages = priorMessages()
  turns.value.push({ id: newId(), role: 'assistant', text: '', tools: [], sources: [], status: 'streaming' })
  // Mutate through the reactive array so every change re-renders.
  const turn = turns.value.at(-1)!
  // Saved now, so the question survives a reload mid-answer. The array is
  // kept so the answer is saved to this chat even if another one is opened.
  const id = chatId.value ??= newId()
  const conversation = turns.value
  history.save(id, conversation)
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
    // Unless the chat was deleted while it was answering.
    if (history.chats.value.some(chat => chat.id === id)) history.save(id, conversation)
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
  chatId.value = null
  draft.value = ''
  nextTick(() => composer.value?.focus())
}

function openChat (id: string) {
  const saved = history.open(id)
  if (!saved) {
    history.refresh()
    return
  }
  stop()
  turns.value = saved
  chatId.value = id
  draft.value = ''
  nextTick(() => {
    end.value?.scrollIntoView({ block: 'end' })
    composer.value?.focus()
  })
}

function removeChat (id: string) {
  history.remove(id)
  if (chatId.value === id) newChat()
}

function clearChats () {
  history.clear()
  newChat()
}

function showHistory () {
  history.refresh()
  historyOpen.value = true
}

// The few latest chats, listed under the suggestions on the empty page.
const recentChats = computed(() => history.chats.value.slice(0, 4))

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

// The logo or the Ask link was clicked while this page is open.
watch(resets, () => newChat())

// The eye watches the caret while you type a question.
const askEye = ref<{ lookAt: (x: number, y: number) => void } | null>(null)

// A different Orwell line under the eye on each visit (archiveQuotes.ts).
const archiveQuote = ref('')

onMounted(() => {
  history.refresh()
  const key = 'korwell-archive-quote'
  let index = 0
  try {
    index = (Number(sessionStorage.getItem(key) ?? -1) + 1) % archiveQuotes.length
    sessionStorage.setItem(key, String(index))
  } catch {
    index = Math.floor(Math.random() * archiveQuotes.length)
  }
  archiveQuote.value = archiveQuotes[index] ?? archiveQuotes[0]!
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
      <ArchiveEye ref="askEye" class="mb-0" :searching="streaming" arrive />
      <p class="eyebrow mx-auto mt-3 mb-4 min-h-[1.5em] max-w-xl leading-normal text-muted"><q v-if="archiveQuote">{{ archiveQuote }}</q></p>
      <h1 id="ask-title" class="text-[clamp(2.4rem,6vw,3.6rem)] leading-tight font-light">What do you want to know?</h1>
      <p class="mt-3 max-w-xl text-lg leading-relaxed text-muted">Korwell searches Kaldi’s documents and Slack, and links every answer to its sources.</p>
      <ChatComposer
        ref="composer"
        v-model="draft"
        large
        class="mt-10 w-[min(46rem,100%)] text-left"
        :streaming="streaming"
        placeholder="Ask about a project, a decision, a person…"
        @caret="(x, y) => askEye?.lookAt(x, y)"
        @submit="ask(draft)"
        @stop="stop"
      />
      <ul class="mt-5 flex max-w-3xl flex-wrap justify-center gap-2" aria-label="Example questions">
        <li v-for="suggestion in suggestions" :key="suggestion">
          <UButton
            color="neutral"
            variant="outline"
            class="bg-transparent hover:bg-transparent hover:text-primary hover:ring-primary"
            :ui="{ label: 'whitespace-normal text-start' }"
            :label="suggestion"
            @click="ask(suggestion)"
          />
        </li>
      </ul>

      <nav v-if="recentChats.length" class="mt-14 w-[min(46rem,100%)] text-left" aria-labelledby="recent-title">
        <div class="flex items-baseline justify-between gap-4 border-b border-default pb-2">
          <h2 id="recent-title" class="font-sans text-sm font-semibold tracking-wide text-muted uppercase">Recent chats</h2>
          <UButton variant="link" class="p-0 text-link" :label="`All chats (${history.chats.value.length})`" @click="showHistory" />
        </div>
        <ul class="divide-y divide-default">
          <li v-for="chat in recentChats" :key="chat.id">
            <button
              type="button"
              class="flex w-full items-baseline gap-4 py-2.5 text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              @click="openChat(chat.id)"
            >
              <UIcon name="i-lucide-message-square" class="size-4 flex-none self-center text-dimmed" />
              <span class="min-w-0 flex-1 truncate">{{ chat.title }}</span>
              <time class="flex-none text-sm text-muted" :datetime="chat.updatedAt">{{ formatShortDate(chat.updatedAt) }}</time>
            </button>
          </li>
        </ul>
      </nav>
    </section>

    <template v-else>
      <!-- One centred column, as in ChatGPT: your question is a bubble on the
           right, Korwell's answer is plain text on the left. -->
      <ol class="mx-auto grid w-[min(48rem,100%-2rem)] flex-1 content-start gap-10 pt-10 pb-6" aria-live="polite">
        <li v-for="pair in pairs" :key="pair.question.id" class="grid gap-6">
          <h2 class="chat-bubble ml-auto max-w-[min(80%,36rem)] font-sans text-[1.0625rem] leading-relaxed font-normal tracking-normal whitespace-pre-wrap text-highlighted [overflow-wrap:anywhere]" :class="{ 'chat-rise': pair.last }">
            <span class="sr-only">You asked: </span>{{ pair.question.text }}
          </h2>

          <article v-if="pair.answer" class="min-w-0" :aria-busy="pair.answer.status === 'streaming'">
            <ChatActivity :tools="pair.answer.tools" :working="pair.answer.status === 'streaming'" :has-text="!!pair.answer.text" />

            <div
              v-if="pair.answer.text"
              class="chat-answer-body"
              :class="{ 'is-streaming': pair.answer.status === 'streaming', 'chat-fade': pair.last }"
              @click="onAnswerClick"
              v-html="renderChatMarkdown(pair.answer.text, sourceUrls(pair.answer))"
            />

            <ol
              v-if="pair.answer.status !== 'streaming' && citedSources(pair.answer).length"
              class="chat-fade mt-5 grid list-decimal gap-1.5 rounded-2xl border border-default py-3 pr-4 pl-9 text-sm marker:font-semibold marker:text-primary"
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

      <div class="sticky bottom-0 bg-linear-to-b from-transparent to-paper to-[1.5rem] pt-6 pb-5">
        <div class="mx-auto flex w-[min(48rem,100%-2rem)] items-end gap-2">
          <UButton color="neutral" variant="outline" size="xl" icon="i-lucide-history" square class="mb-1.5 bg-default" aria-label="Chat history" title="Chat history" @click="showHistory" />
          <UButton color="neutral" variant="outline" size="xl" icon="i-lucide-plus" square class="mb-1.5 bg-default" aria-label="New chat" title="New chat" @click="newChat" />
          <ChatComposer
            ref="composer"
            v-model="draft"
            class="flex-1 shadow-[0_8px_30px_-18px_rgb(89_61_20/0.45)]"
            :streaming="streaming"
            placeholder="Ask a follow-up…"
            @submit="ask(draft)"
            @stop="stop"
          />
        </div>
      </div>
    </template>

    <ChatHistory
      v-model:open="historyOpen"
      :chats="history.chats.value"
      :current-id="chatId"
      @select="openChat"
      @remove="removeChat"
      @clear="clearChats"
    />
  </main>
</template>
