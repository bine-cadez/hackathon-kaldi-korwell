<script setup lang="ts">
// What Korwell looked up for one answer. While it works, a small eye and a live
// line say what it is doing now, and each finished search slides into the list
// above it. Once the answer text arrives the list folds into a one-line summary
// that opens on click.
import type { ToolActivity } from '~/composables/useChatHistory'

const props = defineProps<{ tools: ToolActivity[], working: boolean, hasText: boolean }>()

const open = ref(false)
const listId = useId()

const finished = computed(() => props.tools.filter(tool => tool.done))
const pending = computed(() => props.tools.filter(tool => !tool.done))
// Fold once the answer is being written; before that the steps are the news.
const folded = computed(() => props.hasText && !open.value && finished.value.length > 0)
// The live line shows until text arrives, and again if Korwell goes back to
// searching in the middle of an answer.
const live = computed(() => props.working && (!props.hasText || pending.value.length > 0))

function quoted (value: unknown) {
  return typeof value === 'string' && value ? `“${value}”` : ''
}

function toolLabel (tool: ToolActivity) {
  const { input } = tool
  if (tool.name === 'fetch') return tool.done ? (tool.ok ? `Read ${quoted(tool.title) || 'a document'}` : 'Couldn’t open a document') : 'Reading a document'
  const where = tool.name === 'search_slack' ? 'Slack' : 'documents'
  const what = quoted(input.query) || quoted(input.author)
  const channel = tool.name === 'search_slack' && typeof input.channel === 'string' && input.channel ? ` in #${input.channel.replace(/^#/, '')}` : ''
  const range = typeof input.from === 'string' || typeof input.to === 'string' ? ` · ${input.from || '…'} – ${input.to || '…'}` : ''
  const target = `${where}${what ? ` for ${what}` : ''}${channel}${range}`
  if (!tool.done) return `Searching ${target}`
  if (!tool.ok) return `Searched ${target} · failed`
  return `Searched ${target}`
}

function toolIcon (tool: ToolActivity) {
  return tool.name === 'fetch' ? 'i-lucide-file-text' : tool.name === 'search_slack' ? 'i-lucide-hash' : 'i-lucide-search'
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

const liveLabel = computed(() => {
  const [first, ...rest] = pending.value
  if (first) return `${toolLabel(first)}${rest.length ? ` and ${plural(rest.length, 'other search', 'other searches')}` : ''}`
  if (props.hasText) return 'Writing'
  return finished.value.length ? 'Going through what it found' : 'Thinking'
})

const summary = computed(() => {
  const searches = finished.value.filter(tool => tool.name !== 'fetch')
  const reads = finished.value.filter(tool => tool.name === 'fetch' && tool.ok)
  const results = searches.reduce((sum, tool) => sum + (tool.ok ? tool.count : 0), 0)
  const failed = finished.value.filter(tool => !tool.ok).length
  const parts: string[] = []
  if (searches.length) parts.push(`${plural(searches.length, 'search', 'searches')}, ${plural(results, 'result', 'results')}`)
  if (reads.length) parts.push(`read ${plural(reads.length, 'document', 'documents')}`)
  if (failed) parts.push(`${failed} failed`)
  return parts.join(' · ')
})
</script>

<template>
  <div v-if="tools.length || live" class="mb-4 text-sm">
    <button
      v-if="hasText && finished.length"
      type="button"
      class="group -ml-1 mb-1 flex items-center gap-1.5 rounded-full px-1 py-0.5 text-muted hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
      :aria-expanded="!folded"
      :aria-controls="listId"
      @click="open = !open"
    >
      <UIcon name="i-lucide-telescope" class="size-4 flex-none text-primary" />
      <span>{{ summary }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4 flex-none transition-transform duration-200" :class="{ 'rotate-180': !folded }" />
    </button>

    <div class="chat-fold" :class="{ 'is-folded': folded }">
      <div class="min-h-0 overflow-hidden">
        <TransitionGroup
          :id="listId"
          tag="ol"
          name="chat-step"
          class="chat-steps grid gap-2"
          aria-label="What Korwell looked up"
        >
          <li
            v-for="tool in finished"
            :key="tool.id"
            class="chat-step flex items-start gap-2.5 [overflow-wrap:anywhere]"
            :class="tool.ok ? 'text-muted' : 'text-error'"
          >
            <span class="chat-step-dot">
              <UIcon :name="toolIcon(tool)" class="size-3.5" />
            </span>
            <span class="pt-0.5">
              {{ toolLabel(tool) }}
              <span v-if="tool.ok && tool.name !== 'fetch'" class="ml-1 rounded-full px-1.5 py-px text-xs tabular-nums" :class="tool.count ? 'bg-flame-50 text-link' : 'bg-accented text-muted'">
                {{ plural(tool.count, 'result', 'results') }}
              </span>
            </span>
          </li>
        </TransitionGroup>
      </div>
    </div>

    <Transition name="chat-live">
      <p v-if="live" class="flex items-center gap-2.5 pt-1.5" role="status">
        <ArchiveEye class="inline-eye" searching />
        <span :key="liveLabel" class="chat-shimmer [overflow-wrap:anywhere]">{{ liveLabel }}…</span>
      </p>
    </Transition>
  </div>
</template>
