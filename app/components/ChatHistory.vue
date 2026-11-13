<script setup lang="ts">
import type { SavedChat } from '~/composables/useChatHistory'

// Past Ask conversations in a panel from the left, newest first, grouped by
// day. Picking one opens it in the chat; it can be continued from there.
const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ chats: SavedChat[], currentId: string | null }>()
const emit = defineEmits<{ select: [id: string], remove: [id: string], clear: [] }>()

const filter = ref('')
watch(open, (value) => { if (value) filter.value = '' })

const DAY = 24 * 60 * 60 * 1000

function bucket (iso: string, now: Date) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const time = new Date(iso).getTime()
  if (time >= startOfToday) return 'Today'
  if (time >= startOfToday - DAY) return 'Yesterday'
  if (time >= startOfToday - 7 * DAY) return 'Previous 7 days'
  if (time >= startOfToday - 30 * DAY) return 'Previous 30 days'
  return 'Older'
}

const groups = computed(() => {
  const query = foldDiacritics(filter.value.trim().toLowerCase())
  const now = new Date()
  const result: Array<{ label: string, chats: SavedChat[] }> = []
  for (const chat of props.chats) {
    if (query && !foldDiacritics(chat.title.toLowerCase()).includes(query)) continue
    const label = bucket(chat.updatedAt, now)
    const group = result.at(-1)
    if (group?.label === label) group.chats.push(chat)
    else result.push({ label, chats: [chat] })
  }
  return result
})

function foldDiacritics (text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function select (id: string) {
  emit('select', id)
  open.value = false
}

function clearAll () {
  if (window.confirm('Delete all saved chats in this browser?')) emit('clear')
}
</script>

<template>
  <USlideover
    v-model:open="open"
    side="left"
    title="Chat history"
    description="Saved in this browser only."
    :ui="{ content: 'max-w-sm', body: 'p-0 sm:p-0' }"
  >
    <template #body>
      <div v-if="!chats.length" class="flex flex-col items-center gap-2 px-6 py-16 text-center text-muted">
        <UIcon name="i-lucide-messages-square" class="size-8 text-dimmed" />
        <p>No chats yet. Your questions and Korwell’s answers will show up here.</p>
      </div>

      <template v-else>
        <div class="sticky top-0 z-10 border-b border-default bg-default px-4 py-3">
          <UInput v-model="filter" icon="i-lucide-search" placeholder="Search chats" class="w-full" aria-label="Search chats" />
        </div>

        <p v-if="!groups.length" class="px-6 py-10 text-center text-muted">No chats match “{{ filter }}”.</p>

        <nav v-else aria-label="Saved chats" class="grid gap-4 px-2 py-3">
          <section v-for="group in groups" :key="group.label">
            <h3 class="px-3 pb-1 font-sans text-xs font-semibold tracking-wide text-muted uppercase">{{ group.label }}</h3>
            <ul class="grid gap-0.5">
              <li
                v-for="chat in group.chats"
                :key="chat.id"
                class="group flex items-center rounded-lg hover:bg-elevated"
                :class="{ 'bg-elevated': chat.id === currentId }"
              >
                <button
                  type="button"
                  class="min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                  :class="chat.id === currentId ? 'text-highlighted' : 'text-default'"
                  :aria-current="chat.id === currentId ? 'true' : undefined"
                  :title="chat.title"
                  @click="select(chat.id)"
                >
                  {{ chat.title }}
                </button>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-trash-2"
                  square
                  class="mr-1 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
                  :aria-label="`Delete chat: ${chat.title}`"
                  title="Delete chat"
                  @click="emit('remove', chat.id)"
                />
              </li>
            </ul>
          </section>
        </nav>
      </template>
    </template>

    <template v-if="chats.length" #footer>
      <UButton color="error" variant="ghost" icon="i-lucide-trash" label="Delete all chats" @click="clearAll" />
    </template>
  </USlideover>
</template>
