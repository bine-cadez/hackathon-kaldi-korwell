<script setup lang="ts">
// The Ask input. `large` is the roomy box on the empty page; otherwise it is
// the pill docked under the conversation. Enter sends, Shift+Enter adds a line.
const model = defineModel<string>({ required: true })
const props = defineProps<{ streaming: boolean, large?: boolean, placeholder: string }>()
const emit = defineEmits<{ submit: [], stop: [], caret: [x: number, y: number] }>()

const field = ref<{ textareaRef: HTMLTextAreaElement | null } | null>(null)
defineExpose({ focus: () => field.value?.textareaRef?.focus() })

// Where the caret is on screen, so the eye can watch you type. A textarea does
// not report it, so a hidden copy of the text up to the caret is measured.
const MIRRORED = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'tabSize'] as const
let caretFrame = 0
let mirror: HTMLDivElement | null = null

function trackCaret () {
  cancelAnimationFrame(caretFrame)
  caretFrame = requestAnimationFrame(() => {
    const input = field.value?.textareaRef
    if (!input || document.activeElement !== input) return
    const style = getComputedStyle(input)
    mirror ??= document.body.appendChild(document.createElement('div'))
    Object.assign(mirror.style, { position: 'absolute', top: '0', left: '-9999px', visibility: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' })
    for (const property of MIRRORED) mirror.style[property] = style[property]
    const caret = (input.selectionDirection === 'backward' ? input.selectionStart : input.selectionEnd) ?? 0
    mirror.textContent = input.value.slice(0, caret)
    const marker = mirror.appendChild(document.createElement('span'))
    marker.textContent = '​'
    const bounds = input.getBoundingClientRect()
    emit('caret',
      Math.min(bounds.right, bounds.left + marker.offsetLeft - input.scrollLeft),
      Math.min(bounds.bottom, bounds.top + marker.offsetTop - input.scrollTop + marker.offsetHeight / 2))
  })
}

onMounted(() => document.addEventListener('selectionchange', trackCaret))
onBeforeUnmount(() => {
  document.removeEventListener('selectionchange', trackCaret)
  cancelAnimationFrame(caretFrame)
  mirror?.remove()
})

function onKeydown (event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    emit('submit')
  }
}
</script>

<template>
  <form
    class="flex gap-2 border border-accented bg-default transition-shadow focus-within:border-kaldi-700 focus-within:ring-3 focus-within:ring-primary/20"
    :class="props.large
      ? 'flex-col rounded-[1.75rem] pt-4 pr-3 pb-3 pl-5 shadow-[0_18px_40px_-26px_rgb(89_61_20/0.45)]'
      : 'items-end rounded-[1.75rem] py-2 pr-2 pl-4'"
    @submit.prevent="emit('submit')"
  >
    <label class="sr-only" for="chat-input">Ask Korwell</label>
    <UTextarea
      id="chat-input"
      ref="field"
      v-model="model"
      variant="none"
      :rows="props.large ? 2 : 1"
      autoresize
      :maxrows="8"
      maxlength="8000"
      enterkeyhint="send"
      size="xl"
      class="min-w-0 flex-1"
      :placeholder="placeholder"
      :ui="{ base: 'resize-none px-1 text-[1.0625rem] leading-relaxed placeholder:text-dimmed' }"
      @keydown="onKeydown"
      @input="trackCaret"
      @focus="trackCaret"
    />
    <div class="flex items-center gap-3 text-sm text-muted">
      <span v-if="props.large" class="ps-1">Searches documents and Slack</span>
      <UButton
        v-if="streaming"
        type="button"
        icon="i-lucide-square"
        size="lg"
        square
        class="ms-auto"
        aria-label="Stop answering"
        title="Stop"
        @click="emit('stop')"
      />
      <UButton
        v-else
        type="submit"
        icon="i-lucide-arrow-up"
        size="lg"
        square
        class="ms-auto"
        :disabled="!model.trim()"
        aria-label="Ask Korwell"
        title="Ask Korwell (Enter)"
      />
    </div>
  </form>
</template>
